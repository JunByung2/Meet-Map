"""기존 서버를 그대로 재사용하고 추억지도 조회 API만 추가하는 실행 진입점."""
from app.main import app
from memory_api.routes import router

app.include_router(router)
