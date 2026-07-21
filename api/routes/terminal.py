"""Terminal route — run shell commands inside a project directory.
See execution/terminal.py for the trust-model rationale (direct human
IDE use, not autonomous-agent shell execution — that stays on write_bash
+ HITL, unchanged)."""
import logging
from fastapi import APIRouter, Depends, Request, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from core.database import get_db, AsyncSessionLocal
from api.routes.auth import get_current_user
from execution.terminal import TerminalService, DeniedCommand

logger = logging.getLogger("devos.terminal.route")
router = APIRouter()


class RunReq(BaseModel):
    command: str
    timeout: int = 60


@router.post("/{project_id}/run")
async def run_command(project_id: str, req: RunReq, request: Request, db=Depends(get_db)):
    user = await get_current_user(request, db)
    try:
        return await TerminalService(user.id, project_id).run(req.command, req.timeout)
    except DeniedCommand as e:
        raise HTTPException(403, str(e))


@router.websocket("/{project_id}/ws")
async def terminal_ws(websocket: WebSocket, project_id: str):
    """Streaming terminal. Client connects, sends {"token": "..."} once to
    authenticate (WebSockets can't carry cookies from a different-origin
    frontend reliably), then sends {"command": "..."} messages, one at a time.
    Server streams {"stream": "stdout"|"stderr", "data": "..."} chunks back,
    then a final {"done": true, "exit_code": N, "status": "..."}."""
    await websocket.accept()
    user = None
    try:
        auth_msg = await websocket.receive_json()
        token = auth_msg.get("token", "")
        # Delegates to auth.py's sync_supabase_user()/verify_any_token()
        # (security-audit P2) so Supabase-authenticated users can open a
        # terminal WebSocket too -- the previous inline
        # jwt.decode(..., algorithms=["HS256"]) only understood locally
        # issued tokens.
        from api.routes.auth import verify_any_token, sync_supabase_user
        from core.database import User
        from sqlalchemy import select
        payload, source = verify_any_token(token)
        if payload is None:
            await websocket.send_json({"error": "Invalid or missing token"})
            await websocket.close(code=4401)
            return
        async with AsyncSessionLocal() as db:
            if source == "supabase":
                user = await sync_supabase_user(db, payload)
            else:
                r = await db.execute(select(User).where(User.id == payload["sub"]))
                user = r.scalar_one_or_none()
        if not user:
            await websocket.send_json({"error": "User not found"})
            await websocket.close(code=4401)
            return

        service = TerminalService(user.id, project_id)

        while True:
            msg = await websocket.receive_json()
            command = msg.get("command", "")
            if not command:
                continue

            async def on_chunk(stream_name, data: bytes):
                await websocket.send_json({
                    "stream": stream_name,
                    "data": data.decode(errors="replace"),
                })

            try:
                result = await service.run_streaming(command, on_chunk, msg.get("timeout", 60))
                await websocket.send_json({"done": True, **result})
            except DeniedCommand as e:
                await websocket.send_json({"done": True, "status": "denied", "error": str(e)})

    except WebSocketDisconnect:
        logger.info(f"Terminal WS disconnected (project={project_id})")
    except Exception as e:
        logger.warning(f"Terminal WS error: {e}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
