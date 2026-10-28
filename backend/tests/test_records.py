"""약속 기록 API 검증. 임시 SQLite + 가짜 저장소만 쓰고 공유 DB/Supabase 에는 접속하지 않는다.
backend 폴더에서:  python tests/test_records.py
"""
import io
import os
import sys
import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALLOW_DEV_AUTH"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException, UploadFile
from sqlalchemy import BigInteger, create_engine, text
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app import storage
from app.db import Base
from app.deps.auth import require_group_member
from app.models import Group, GroupMember, Photo, User
from app.routers import messages as _messages_model  # noqa: F401  (messages 표를 Base 에 등록)
from app.routers import records


@compiles(BigInteger, "sqlite")
def sqlite_big_integer(element, compiler, **kw):
    return "INTEGER"


checks = 0


def check(cond, label):
    global checks
    assert cond, label
    checks += 1
    print(f"PASS {label}")


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def png(name="a.png"):
    return UploadFile(file=io.BytesIO(PNG), filename=name)


def raises(code, fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code == code
    return False


def main():
    with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
        engine = create_engine(f"sqlite:///{Path(tmp) / 't.sqlite'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([User(id=i, nickname=f"m{i}", status="active") for i in (1, 2, 3)])
            db.flush()
            db.add_all([Group(id=11, name="g11", created_by=1), Group(id=12, name="g12", created_by=3)])
            db.flush()
            db.add_all(GroupMember(group_id=g, user_id=u, role=r) for g, u, r in ((11, 1, "owner"), (11, 2, "member"), (12, 3, "owner")))
            db.commit()

        stored: list[str] = []
        removed: list[str] = []
        fake = {
            "is_configured": lambda: True,
            "upload": lambda path, data, ct: stored.append(path),
            "signed_urls": lambda paths: {p: f"https://signed/{p}" for p in paths},
            "remove": lambda paths: removed.extend(paths),
            "download": lambda path: (b"%PDF-1.4 fake", "application/pdf"),
        }

        def ctx(user, group):
            db = Session(engine, expire_on_commit=False)
            u = db.get(User, user)
            m = require_group_member(group, u, db)
            return db, u, m

        with patch.multiple(storage, **fake):
            # 1) 사진 없이 기록 (빈 상태) + 참여자 저장
            db, u, m = ctx(1, 11)
            out = records.create_record(11, "서울숲 소풍", date(2026, 10, 22), "좋았던 날", None, None, "서울숲", "주소", 37.5, 127.0, [], m, u, db)
            rid = out.record.id
            check(out.record.photo_count == 0 and out.photos == [], "사진 없는 기록도 저장된다")
            check(out.record.place_name == "서울숲" and out.record.note == "좋았던 날", "장소·한 줄 문구 저장")

            # 2) 사진 포함 기록
            out2 = records.create_record(11, "카페", date(2026, 10, 25), "", None, None, None, None, None, None, [png("a.png"), png("b.png")], m, u, db)
            check(out2.record.photo_count == 0 and len(stored) == 2, "기록에 직접 붙인 사진은 기록에 보이지 않는다 (채팅 사진만 보인다)")
            db.close()

            # 3) 새로고침(새 세션)해도 유지 + 최신 날짜 순
            db, u, m = ctx(2, 11)
            lst = records.list_records(11, m, u, db)
            check([r.title for r in lst] == ["카페", "서울숲 소풍"], "새 세션에서도 목록 유지, 날짜 최신순")
            check(lst[0].can_edit is False, "남의 기록은 can_edit False")
            check(records.record_detail(11, rid, m, u, db).record.title == "서울숲 소풍", "상세 조회")
            check(raises(403, lambda: records.update_record(11, rid, records.RecordPatch(note="x"), m, u, db)), "남의 기록 수정 403")
            check(raises(403, lambda: records.delete_record(11, rid, m, u, db)), "남의 기록 삭제 403")
            check(raises(422, lambda: records.create_record(11, "x", date.today(), "", None, None, None, None, None, None, [UploadFile(file=io.BytesIO(b"hi"), filename="a.exe")], m, u, db)), "허용 안 된 확장자 422")
            check(raises(422, lambda: records.create_record(11, "x", date.today(), "", None, None, None, None, None, None, [UploadFile(file=io.BytesIO(b"not png"), filename="a.png")], m, u, db)), "가짜 이미지 422")
            check(len(records.list_records(11, m, u, db)) == 2, "실패한 요청은 기록을 남기지 않는다")
            db.close()

            # 4) 접근통제
            check(raises(403, lambda: ctx(3, 11)), "그룹 멤버가 아니면 403")
            db, u, m = ctx(3, 12)
            check(records.list_records(12, m, u, db) == [], "다른 그룹 기록은 안 보임")
            check(raises(404, lambda: records.record_detail(12, rid, m, u, db)), "다른 그룹 기록 번호는 404")
            db.close()

            # 5) 수정·사진 더하기·삭제 (기록한 사람/방장)
            db, u, m = ctx(1, 11)
            res = records.update_record(11, rid, records.RecordPatch(title="서울숲 산책", note=""), m, u, db)
            check(res.title == "서울숲 산책" and res.note is None, "수정")
            added = records.add_photos(11, rid, [png("c.png")], m, u, db)
            check(added.record.photo_count == 0, "직접 더한 사진도 기록에는 보이지 않는다")
            # 6) 확정된 약속 → 지난 기록 자동 생성 (meetings 표는 앱이 만든 실제 모양)
            from datetime import datetime, timedelta, timezone
            from app.models import Meeting, MeetingCandidate, MeetingVote
            from app.records_sync import KST
            from app.routers import messages as chat, photos as photo_api

            kst_now = datetime.now(KST)
            today_noon = kst_now.replace(hour=12, minute=0, second=0, microsecond=0)
            old = datetime(2026, 10, 17, 9, 0, tzinfo=KST)  # 한국 시간 오전 9시 = UTC 0시 (날짜 경계 확인용)
            db.add_all([
                Meeting(id=1, group_id=11, title="홍대입구 모임", location="홍대입구", meeting_time=old, status="confirmed",
                        place_id="p1", place_address="서울 마포구", place_lat=37.55, place_lng=126.92),
                Meeting(id=2, group_id=11, title="투표중", location="신촌", meeting_time=old, status="voting"),
                Meeting(id=3, group_id=12, title="다른 그룹", location="x", meeting_time=old, status="confirmed"),
            ])
            db.add_all([MeetingCandidate(id=1, group_id=11, title="홍대", location="홍대", meeting_time=old + timedelta(days=30), created_by=1)])
            db.flush()
            db.add_all([MeetingVote(candidate_id=1, user_id=1)])
            # 10/17 한국 시간 새벽 1시에 2번이 채팅 (UTC 로는 10/16 이라 날짜 변환이 틀리면 놓친다)
            db.add(chat.Message(group_id=11, user_id=2, text="내일 몇 시에 봐?", created_at=datetime(2026, 10, 17, 1, 0, tzinfo=KST)))
            db.add(chat.Message(group_id=11, user_id=1, text="다른 날 채팅", created_at=datetime(2026, 10, 18, 1, 0, tzinfo=KST)))
            db.commit()

            lst = records.list_records(11, m, u, db)
            auto = [r for r in lst if r.meeting_id == 1]
            check(len(auto) == 1 and auto[0].title == "홍대입구 모임" and auto[0].meet_date == date(2026, 10, 17), "확정된 약속이 지난 기록으로 자동 생성 (제목·한국 날짜)")
            check(all(r.meeting_id != 2 for r in lst) and all(r.meeting_id != 3 for r in lst), "투표 중·다른 그룹 약속은 만들지 않는다")
            check(auto[0].place_name == "홍대입구" and auto[0].place_lat == 37.55, "약속의 카카오 장소가 기록 장소로 들어간다")
            records.list_records(11, m, u, db)
            check(db.query(records.MeetingRecord).filter_by(group_id=11, meeting_id=1).count() == 1, "목록을 다시 열어도 기록은 중복되지 않는다")
            arid = auto[0].id

            # 7) 자동 기록은 멤버 누구나 문구를 고칠 수 있다
            db2, u2, m2 = ctx(2, 11)
            res = records.update_record(11, arid, records.RecordPatch(note="즐거웠다"), m2, u2, db2)
            check(res.note == "즐거웠다", "자동 기록은 멤버 누구나 문구 수정")
            # 지난 기록 삭제: 약속이 그대로여도 다시 만들어지지 않는다 (흔적만 남김). 사진은 사진 모음에 남는다.
            records.add_photos(11, arid, [png("keep.png")], m, u, db)
            photos_before = db.query(Photo).filter(Photo.group_id == 11).count()
            records.delete_record(11, arid, m, u, db)
            check(all(r.id != arid for r in records.list_records(11, m, u, db)), "삭제한 기록은 목록에서 사라진다")
            check(db.query(records.MeetingRecord).filter_by(group_id=11, meeting_id=1).count() == 1, "목록을 다시 열어도 같은 약속의 기록이 되살아나지 않는다")
            check(db.query(Photo).filter(Photo.group_id == 11).count() == photos_before, "기록을 지워도 사진은 사진 모음에 남는다")
            check(raises(404, lambda: records.record_detail(11, arid, m, u, db)), "삭제한 기록 상세는 404")

            # 8) 채팅 날짜 이동: from_date 부터의 대화 (한국 시간 기준)
            from app.routers import messages as chat_api
            jump = chat_api.list_messages(11, None, m2, u2, db2, from_date=date(2026, 10, 17))
            check([c.text for c in jump] == ["내일 몇 시에 봐?", "다른 날 채팅"], "from_date 로 그 날짜 첫 대화부터 보인다")
            jump2 = chat_api.list_messages(11, None, m2, u2, db2, from_date=date(2026, 10, 18))
            check([c.text for c in jump2] == ["다른 날 채팅"], "한국 시간 날짜 경계가 맞는다")
            first_id = jump[0].id
            check(chat_api.list_messages(11, None, m2, u2, db2, before_id=first_id) == [], "before_id: 더 이전 메시지가 없으면 빈 목록")
            check([c.text for c in chat_api.list_messages(11, None, m2, u2, db2, before_id=jump[-1].id)] == ["내일 몇 시에 봐?"], "before_id: 그 앞 메시지를 오래된 순으로")
            db2.close()

            # 9) 사진 자동 연결: 오늘 확정된 약속이 하나일 때만
            db.add(Meeting(id=10, group_id=11, title="오늘 약속", location="성수", meeting_time=today_noon, status="confirmed"))
            db.commit()
            up = photo_api.upload_photos(11, [png("t.png")], [], "", "", None, None, None, None, None, m, u, db)
            today_rec = db.query(records.MeetingRecord).filter_by(group_id=11, meeting_id=10).one()
            check(db.query(Photo).filter_by(record_id=today_rec.id).count() == 1, "오늘 올린 사진이 오늘 약속 기록에 자동으로 붙는다")
            db.add(Meeting(id=11, group_id=11, title="오늘 약속2", location="건대", meeting_time=today_noon, status="confirmed"))
            db.commit()
            photo_api.upload_photos(11, [png("t2.png")], [], "", "", None, None, None, None, None, m, u, db)
            check(db.query(Photo).filter_by(record_id=today_rec.id).count() == 1, "오늘 약속이 둘이면 자동 연결하지 않는다")

            # 10) 투표 후보에 카카오 장소 저장 + 확정하면 약속으로 복사
            from app.routers import meetings as meet_api
            cand = meet_api.create_candidate(11, meet_api.CandidateCreate(title="후보", location="성수 카페", meeting_time=today_noon + timedelta(days=5), place_id="k9", place_address="서울 성동구", place_lat=37.54, place_lng=127.05), m, u, db)
            check(cand["place_lat"] == 37.54 and cand["place_id"] == "k9" and cand["location"] == "성수 카페", "투표 후보에 장소(좌표) 저장")

            # 10-2) 시간이 겹치는 약속은 만들 수 없다 (오늘 12:00 약속이 이미 확정돼 있다)
            naive_noon = today_noon.replace(tzinfo=None)  # SQLite 는 시간대를 저장하지 않아 시계 값 그대로 비교한다
            check(raises(409, lambda: meet_api.create_candidate(11, meet_api.CandidateCreate(title="겹침", location="x", meeting_time=naive_noon + timedelta(minutes=60)), m, u, db)), "확정된 약속과 1시간 차이면 후보도 못 만든다")
            ok_c = meet_api.create_candidate(11, meet_api.CandidateCreate(title="안겹침", location="x", meeting_time=naive_noon + timedelta(hours=3)), m, u, db)
            check(ok_c["id"] is not None, "2시간 이상 떨어지면 만들 수 있다")
            check(raises(409, lambda: meet_api.create_candidate(11, meet_api.CandidateCreate(title="겹침2", location="x", meeting_time=naive_noon - timedelta(minutes=90)), m, u, db)), "앞쪽으로 겹쳐도 막는다")

            # 11) 약속 확정은 방장이 아니라 투표(후보)를 만든 사람만
            db3, u3, m3 = ctx(2, 11)
            check(raises(403, lambda: meet_api.confirm_candidate(11, 1, False, m3, u3, db3)), "투표를 만든 사람이 아니면 확정 403")
            res = meet_api.confirm_candidate(11, 1, False, m, u, db)
            check(res["meeting"]["place_lat"] == 37.55 or res["meeting"]["title"] == "홍대", "투표를 만든 사람은 확정할 수 있다")
            check(res["meeting"]["id"] is not None, "확정하면 약속이 만들어진다")
            check(raises(409, lambda: meet_api.confirm_candidate(11, 1, False, m, u, db)), "이미 확정된 투표는 다시 확정 못 한다")
            check(raises(409, lambda: meet_api.vote_candidate(11, 1, m3, u3, db3)), "확정된 투표에는 투표 못 한다")

            # 11-2) 약속 삭제 권한: 방장 또는 확정한 사람만 (지난 기록은 남는다)
            mid = res["meeting"]["id"]
            meet_api.delete_meeting(11, mid, m3, u3, db3)
            check(db.get(Meeting, mid) is None, "그룹 멤버라면 누구나 확정된 약속을 지울 수 있다")
            check(raises(404, lambda: meet_api.delete_meeting(12, mid, m, u, db)), "다른 그룹 번호로는 지울 수 없다")

            # 11-3) 채팅 첨부(문서/사진) + 지난 기록 사진 + 메시지 삭제
            from datetime import datetime, timedelta, timezone
            from app.routers import chat_files
            att = chat_files.upload_chat_file(11, UploadFile(file=io.BytesIO(b"%PDF-1.4 hello"), filename="리포트.pdf"), "file", m, u, db)
            check(att.kind == "file" and att.filename == "리포트.pdf" and att.signed_url is None, "PDF 파일 첨부")
            hwp = chat_files.upload_chat_file(11, UploadFile(file=io.BytesIO(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 20), filename="보고서.hwp"), "file", m, u, db)
            check(hwp.kind == "file", "한글(HWP) 파일 첨부")
            for bad in (("a.exe", b"MZ..."), ("a.pdf", b"not a pdf"), ("a.html", b"<html>")):
                check(raises(422, lambda bad=bad: chat_files.upload_chat_file(11, UploadFile(file=io.BytesIO(bad[1]), filename=bad[0]), "file", m, u, db)), f"{bad[0]} 거부")
            kst_today = datetime.now(timezone(timedelta(hours=9))).date()
            rec_today = records.create_record(11, "오늘 기록", kst_today, "", None, None, None, None, None, None, [], m, u, db)
            check(rec_today.record.photo_count == 0, "채팅 사진을 보내기 전에는 그날 기록에 사진이 없다")
            att_img = chat_files.upload_chat_file(11, png("q.png"), "image", m, u, db)
            check(att_img.kind == "image" and att_img.signed_url is not None, "사진 첨부는 임시 주소를 준다")
            detail_today = records.record_detail(11, rec_today.record.id, m, u, db)
            check(detail_today.record.photo_count >= 1 and len(detail_today.photos) == detail_today.record.photo_count, "그날 채팅으로 보낸 사진은 지난 기록에 모인다")
            from app.routers import photos as photo_list
            listed_photos = photo_list.list_photos(11, m, u, db)
            check(any(x.from_chat for x in listed_photos) and any(not x.from_chat for x in listed_photos), "사진 목록에 채팅 사진 / 직접 올린 사진 구분이 있다")
            other_day = records.create_record(11, "다른 날", date(2020, 1, 1), "", None, None, None, None, None, None, [], m, u, db)
            check(other_day.record.photo_count == 0, "다른 날 기록에는 안 보인다")
            check(not any("db:" in r for r in removed), "문서 파일은 저장소를 쓰지 않는다")
            dl = chat_files.download_chat_file(11, att.id, m, db)
            check(dl.body.startswith(b"%PDF") and "attachment" in dl.headers["content-disposition"] and dl.headers["x-content-type-options"] == "nosniff", "문서는 DB 에서 attachment 로만 내려준다")
            dbx, ux, mx = ctx(3, 12)
            check(raises(404, lambda: chat_files.chat_file_info(12, att.id, mx, dbx)), "다른 그룹의 첨부 번호는 404")
            dbx.close()
            msg = chat.send_message(11, chat.MessageIn(text=f"📎 리포트.pdf\nattach:{att.id}"), m, u, db)
            check(raises(403, lambda: chat.delete_message(11, msg.id, m3, u3, db3)), "남의 메시지는 삭제 못 한다")
            chat.delete_message(11, msg.id, m, u, db)
            check(db.get(chat_files.ChatAttachment, att.id) is None, "메시지를 지우면 첨부도 정리된다")

            # 12) 투표 묶음(poll) 분리: 다른 투표의 표/확정이 섞이지 않는다
            def mk(title, poll):
                return meet_api.create_candidate(11, meet_api.CandidateCreate(title=title, location="장소", meeting_time=today_noon + timedelta(days=7), poll_id=poll), m, u, db)["id"]
            a1, a2, b1 = mk("A", "pollA"), mk("A", "pollA"), mk("B", "pollB")
            meet_api.vote_candidate(11, a1, m3, u3, db3)
            meet_api.vote_candidate(11, b1, m3, u3, db3)  # 다른 투표에 투표해도 A 의 내 표는 유지
            listed = {c["id"]: c for c in meet_api.list_candidates(11, m3, u3, db3)}
            check(listed[a1]["vote_count"] == 1 and listed[a1]["voted_by_me"] and listed[b1]["voted_by_me"], "투표 묶음마다 내 표가 따로 유지된다")
            check([v["nickname"] for v in listed[a1]["voters"]] == ["m2"] and listed[a2]["voters"] == [], "항목별 투표자 목록")
            meet_api.vote_candidate(11, a2, m3, u3, db3)  # 같은 묶음 안에서는 표가 옮겨진다
            listed = {c["id"]: c for c in meet_api.list_candidates(11, m3, u3, db3)}
            check(listed[a1]["vote_count"] == 0 and listed[a2]["vote_count"] == 1, "같은 투표 안에서는 표 변경")
            meet_api.confirm_candidate(11, a2, False, m, u, db)
            listed = {c["id"]: c for c in meet_api.list_candidates(11, m3, u3, db3)}
            check(listed[a2]["chosen"] and listed[a1]["closed"] and not listed[b1]["closed"], "확정은 그 투표만 닫는다")
            db3.close()
            db.close()
        engine.dispose()
    print(f"\n{checks} checks passed")


if __name__ == "__main__":
    main()
