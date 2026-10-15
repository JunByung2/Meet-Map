"""개발용 더미 데이터: 팀원 5명(로그인 가능) + 그룹 "중부대 친구들"(미강=방장) + 그룹 밖 외부인 1명.

- 개발 환경(ALLOW_DEV_AUTH=true)에서만 실행된다. 배포 DB 에는 절대 실행하지 말 것.
- 여러 번 실행해도 안전하다 (이미 있는 것은 건드리지 않고, 비어 있는 이메일/비밀번호만 채운다).
- 더미 계정 비밀번호는 환경변수 SEED_PASSWORD 로 정한다. (코드에 비밀번호를 적지 않기 위해 필수)
- 소셜 로그인으로 가입한 실제 회원에게는 이메일/비밀번호를 붙이지 않는다.

실행(backend 폴더에서):
    set "SEED_PASSWORD=원하는비밀번호"   (8자 이상)
    python scripts_seed_dev.py
로그인 이메일: mingang@example.com, jongeun@example.com, minyoung@example.com,
               seonghye@example.com, dahyun@example.com, outsider@example.com
"""
import os
import sys

from sqlalchemy import select

from app.config import ALLOW_DEV_AUTH
from app.db import Base, SessionLocal, engine
from app.models import Group, GroupMember, OAuthAccount, User
from app.security import hash_password

if not ALLOW_DEV_AUTH:
    sys.exit("개발 환경(ALLOW_DEV_AUTH=true)에서만 실행할 수 있습니다.")

password = os.getenv("SEED_PASSWORD")
if not password or len(password) < 8:
    sys.exit('SEED_PASSWORD 환경변수(8자 이상)를 먼저 설정하세요. 예) set "SEED_PASSWORD=원하는비밀번호"')

Base.metadata.create_all(engine)

DUMMY = [  # (닉네임, 이메일)  순서 = 더미 회원 6명
    ("미강", "mingang@example.com"),
    ("종은", "jongeun@example.com"),
    ("민영", "minyoung@example.com"),
    ("성혜", "seonghye@example.com"),
    ("다현", "dahyun@example.com"),
    ("외부인", "outsider@example.com"),
]

with SessionLocal() as db:
    social_user_ids = select(OAuthAccount.user_id)  # 소셜 로그인으로 가입한 실제 회원들
    users: list[User] = []

    for nickname, email in DUMMY:
        # 1) 이메일로 먼저 찾는다
        user = db.execute(select(User).where(User.email == email)).scalars().first()

        # 2) 없으면, 이메일이 비어 있고 소셜 계정이 아닌 같은 닉네임 회원(예전에 만든 더미)을 찾는다
        if user is None:
            user = db.execute(
                select(User)
                .where(User.nickname == nickname, User.email.is_(None), User.id.not_in(social_user_ids))
                .order_by(User.id)
            ).scalars().first()

        # 3) 그래도 없으면 새로 만든다
        if user is None:
            user = User(nickname=nickname)
            db.add(user)

        if user.email is None:
            user.email = email
        if user.password is None:
            user.password = hash_password(password)  # 회원마다 따로 해시한다
        users.append(user)
    db.flush()

    group = db.execute(select(Group).where(Group.name == "중부대 친구들").order_by(Group.id)).scalars().first()
    if group is None:
        group = Group(name="중부대 친구들", icon="🎓", created_by=users[0].id)
        db.add(group)
        db.flush()

    for i, u in enumerate(users[:5]):  # 외부인(users[5])은 일부러 그룹에 넣지 않는다
        if db.get(GroupMember, (group.id, u.id)) is None:
            db.add(GroupMember(group_id=group.id, user_id=u.id, role="owner" if i == 0 else "member"))
    db.commit()
    print("users:", {u.nickname: u.id for u in users}, "group_id:", group.id)