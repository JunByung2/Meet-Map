"""임시 SQLite와 가짜 교통 응답으로 검증. 공유 DB/실제 API에 접속하지 않는다.
backend에서 python tests/test_place_plans.py
"""
import os
from pathlib import Path
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import BigInteger, create_engine, func, select
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.deps.auth import require_group_member
from app.models import Group, GroupMember, User
from app.routers.messages import Message, router as messages_router
from meeting_tools.planning import routes
from meeting_tools.planning.models import Departure, PlacePlan, PlanningBase

@compiles(BigInteger, "sqlite")
def sqlite_big_integer(element, compiler, **kw):
    return "INTEGER"

checks = 0
def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print(f"PASS {label}")

def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
        engine = create_engine(f"sqlite:///{Path(tmp) / 'test.sqlite'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        PlanningBase.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([User(id=i, nickname=f"member{i}", status="active") for i in (1, 2, 3)])
            db.flush()
            db.add_all([Group(id=i, name=f"group{i}", created_by=1) for i in (11, 12, 22)])
            db.flush()
            db.add_all([GroupMember(group_id=g, user_id=u, role="member")
                        for g, u in ((11, 1), (11, 2), (12, 3), (22, 1), (22, 2))])
            db.commit()

        # 동기 경로 함수 + 실제 그룹 접근통제 의존성을 검증한다.
        # ASGI 네트워크 계층은 이 테스트의 범위가 아니다.
        class Response:
            def __init__(self, status, data):
                self.status_code = status
                self.data = jsonable_encoder(data)
                self.text = str(self.data)
            def json(self):
                return self.data

        def call(method, path, user=1, **kwargs):
            with Session(engine, expire_on_commit=False) as db:
                try:
                    identity = db.get(User, user) if user else None
                    if not identity:
                        raise HTTPException(401, '로그인이 필요합니다.')
                    parts = path.strip('/').split('/')
                    group_id = int(parts[1])
                    member = require_group_member(group_id, identity, db)
                    if parts[2] == 'messages':
                        from app.routers.messages import list_messages
                        return Response(200, list_messages(group_id, None, member, identity, db))
                    if len(parts) == 3:
                        value = routes.create_plan(group_id, routes.CreatePlan(**kwargs['json']), identity, db)
                        return Response(201, value)
                    plan_id = parts[3]
                    if len(parts) == 4:
                        value = routes.read_plan(group_id, plan_id, identity, db)
                    elif parts[4] == 'recommend':
                        value = routes.recommend(group_id, plan_id, identity, db)
                    elif method == 'PUT':
                        value = routes.save_departure(group_id, plan_id, routes.DepartureIn(**kwargs['json']), identity, db)
                    else:
                        value = routes.delete_departure(group_id, plan_id, identity, db)
                    return Response(200, value)
                except HTTPException as error:
                    return Response(error.status_code, {'detail': error.detail})
                except ValidationError:
                    return Response(422, {'detail': 'validation error'})

        if True:
            base = "/groups/11/place-plans"
            plan_id = str(uuid4())
            body = {"request_id": plan_id}
            check((call("POST", base, user=0, json=body)).status_code == 401, "login required")
            check((call("POST", base, user=3, json=body)).status_code == 403, "non-member denied")
            response = call("POST", base, json=body)
            check(response.status_code == 201 and response.json()["id"] == plan_id, "create plan")
            check((call("POST", base, json=body)).status_code == 201, "retry reuses plan")
            messages = (call("GET", "/groups/11/messages")).json()
            check(len(messages) == 1 and f"planId={plan_id}" in messages[0]["text"], "one persistent chat invitation")
            path = f"{base}/{plan_id}"
            check((call("GET", path, user=3)).status_code == 403, "other group's user denied")
            check((call("GET", f"/groups/22/place-plans/{plan_id}")).status_code == 404, "plan ID bound to group")
            location = {"place_id": "station1", "name": "출발역", "address": "서울",
                        "latitude": 37.55, "longitude": 126.92}
            check((call("PUT", f"{path}/my-departure", json={**location, "user_id": 2})).status_code == 422,
                  "cannot submit another user's ID")
            check((call("PUT", f"{path}/my-departure", json={**location, "latitude": 91})).status_code == 422,
                  "invalid coordinate rejected")
            check((call("PUT", f"{path}/my-departure", json=location)).status_code == 200, "save own departure")
            state2 = (call("GET", path, user=2)).json()
            check(state2["own_departure"] is None and state2["members"][0]["ready"], "other member sees ready status")
            check("latitude" not in state2["members"][0], "private departure coordinates omitted")
            check((call("POST", f"{path}/recommend")).status_code == 409, "all members must enter")
            call("PUT", f"{path}/my-departure", user=2, json={**location, "longitude": 127.02})
            check((call("GET", path)).json()["can_recommend"], "all members ready")
            other_id = str(uuid4())
            call("POST", base, json={"request_id": other_id})
            check(not any(m["ready"] for m in (call("GET", f"{base}/{other_id}")).json()["members"]),
                  "two plans in one group are isolated")

            fake_result = {"ranking_rule": "평균 50% + 최대 50%", "excluded_count": 0,
                "recommendations": [{"id": "candidate", "name": "중간역", "address": "서울",
                    "latitude": 37.5, "longitude": 127, "average": 20, "maximum": 25, "member_minutes": [15, 25]}]}
            with patch.object(routes, "recommend_places", return_value=fake_result) as fetch:
                result = call("POST", f"{path}/recommend")
                check(result.status_code == 200 and result.json()["result"]["member_ids"] == [1, 2], "recommend from saved members")
                check(len(fetch.call_args[0][0]) == 2, "server uses both saved departures")
                check((call("GET", path, user=2)).json()["result"] is not None, "shared result survives reload")
                call("POST", f"{path}/recommend", user=2)
                check(fetch.call_count == 1, "same inputs reuse saved result")
            call("PUT", f"{path}/my-departure", user=2, json={**location, "longitude": 127.03})
            check((call("GET", path)).json()["result"] is None, "changing departure invalidates result")

            def changed_while_calculating(locations):
                with Session(engine, expire_on_commit=False) as db:
                    user = db.get(User, 2)
                    routes.save_departure(11, plan_id, routes.DepartureIn(**{**location, "longitude": 127.04}), user, db)
                return fake_result
            with patch.object(routes, "recommend_places", side_effect=changed_while_calculating):
                check((call("POST", f"{path}/recommend")).status_code == 409, "stale in-flight result rejected")
            with patch.object(routes, "recommend_places", side_effect=routes.TransitError("internal API detail")):
                failure = call("POST", f"{path}/recommend")
                check(failure.status_code == 502 and "internal API" not in failure.text, "upstream error sanitized")
            with patch.object(routes, "recommend_places", return_value=fake_result):
                call("POST", f"{path}/recommend")
            with Session(engine) as db:
                db.add(GroupMember(group_id=11, user_id=3, role="member"))
                db.commit()
            changed = (call("GET", path)).json()
            check(not changed["can_recommend"] and changed["result"] is None, "membership change invalidates result")
            with Session(engine) as db:
                member = db.get(GroupMember, (11, 2))
                member.joined_at = datetime.now(timezone.utc) + timedelta(seconds=1)
                db.commit()
            check((call("GET", path, user=2)).json()["own_departure"] is None, "rejoining does not reuse old departure")
            call("DELETE", f"{path}/my-departure")
            check((call("GET", path)).json()["own_departure"] is None, "deletion persists")
        engine.dispose()
    print(f"{checks} checks passed; shared DB and external APIs untouched.")

if __name__ == "__main__":
    main()
