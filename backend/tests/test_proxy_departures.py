"""Local SQLite only; no real DB or transit calls."""
import os
import sys
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite://'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI, Depends, Header
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from app.deps.auth import require_group_member
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.models import User, Group, GroupMember
from app.deps.auth import get_current_user
from meeting_tools.planning.models import PlanningBase
from meeting_tools.planning import routes

from sqlalchemy import BigInteger
from sqlalchemy.ext.compiler import compiles
@compiles(BigInteger, 'sqlite')
def sqlite_bigint(element, compiler, **kw): return 'INTEGER'

engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
Base.metadata.create_all(engine)
PlanningBase.metadata.create_all(engine)
def db_session():
    with Session(engine) as db:
        yield db
def identity(x_test_user: int = Header(default=1), db=Depends(get_db)):
    return db.get(User, x_test_user)
app = FastAPI()
app.include_router(routes.router)
app.dependency_overrides[get_db] = db_session
app.dependency_overrides[get_current_user] = identity
with Session(engine) as db:
    db.add_all([User(id=i, nickname=f'member{i}') for i in (1,2,3,4)])
    db.flush()
    db.add(Group(id=11, name='test group', created_by=1))
    db.flush()
    db.add_all([GroupMember(group_id=11, user_id=i) for i in (1,2,3)])
    db.commit()

# Invoke route functions with the real membership dependency. No HTTP transport.
class LocalClient:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def request(self, method, path, json=None, headers=None):
        from types import SimpleNamespace
        from urllib.parse import urlsplit, parse_qs
        url=urlsplit(path); parts=url.path.strip('/').split('/')
        with Session(engine) as db:
            try:
                user=db.get(User,int((headers or {}).get('x-test-user',1)))
                group_id=int(parts[1])
                require_group_member(group_id,user,db)
                if len(parts)==3:
                    value=routes.create_plan(group_id,routes.CreatePlan(**json),user,db); status=201
                else:
                    plan_id=parts[3]; status=200
                    if len(parts)==4: value=routes.read_plan(group_id,plan_id,user,db)
                    elif parts[4]=='recommend': value=routes.recommend(group_id,plan_id,user,db)
                    elif method=='PUT': value=routes.save_departure(group_id,plan_id,routes.DepartureIn(**json),user,db)
                    else:
                        target=parse_qs(url.query).get('target_user_id',[None])[0]
                        value=routes.delete_departure(group_id,plan_id,user,db,int(target) if target else None)
                value=jsonable_encoder(value)
            except HTTPException as error:
                status=error.status_code; value={'detail':error.detail}
            return SimpleNamespace(status_code=status,text=str(value),json=lambda:value)
    def post(self,path,**kw): return self.request('POST',path,**kw)
    def get(self,path,**kw): return self.request('GET',path,**kw)
    def put(self,path,**kw): return self.request('PUT',path,**kw)
    def delete(self,path,**kw): return self.request('DELETE',path,**kw)

with LocalClient() as client:
    plan_id = str(uuid4())
    base = f'/groups/11/place-plans/{plan_id}'
    assert client.post('/groups/11/place-plans', json={'request_id':plan_id}).status_code == 201
    location = dict(place_id='s',name='station',address='',latitude=37.5,longitude=127)
    assert client.put(base+'/my-departure',json=location).status_code == 200
    assert client.post(base+'/recommend').status_code == 409
    response = client.put(base+'/my-departure',json={**location,'target_user_id':2})
    assert response.status_code == 200
    state = response.json()
    assert state['can_recommend'] and not state['members'][2]['ready']
    assert state['members'][1]['departure']['updated_by'] == 1
    assert client.put(base+'/my-departure',json={**location,'target_user_id':4}).status_code == 403
    assert client.put(base+'/my-departure',headers={'x-test-user':'4'},json=location).status_code == 403
    fake = {'recommendations':[], 'ranking_rule':'test','excluded_count':0}
    with patch.object(routes,'recommend_places',return_value=fake) as provider:
        response=client.post(base+'/recommend',headers={'x-test-user':'2'})
        assert response.status_code == 200, response.text
        assert response.json()['result']['member_ids'] == [1,2]
        assert len(provider.call_args.args[0]) == 2
        client.post(base+'/recommend')
        assert provider.call_count == 1
    assert client.put(base+'/my-departure',headers={'x-test-user':'2'},json=location).json()['result'] is None
    state=client.get(base).json()
    assert state['members'][1]['departure']['updated_by'] == 2
    assert client.delete(base+'/my-departure?target_user_id=4').status_code == 403
    response=client.delete(base+'/my-departure?target_user_id=2')
    assert response.status_code == 200 and not response.json()['can_recommend']
    assert response.json()['members'][0]['ready']
    assert client.delete(base+'/my-departure').status_code == 200
print('PASS proxy input, own overwrite, partial participants, cache, invalidation, scoped deletion, group authorization')
