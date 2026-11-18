import type { Metadata } from "next";
import Link from "next/link";
import css from "./privacy.module.css";

export const metadata: Metadata = {
  title: "개인정보 처리방침 · MeetMap",
  description:
    "MeetMap의 개인정보 수집 항목, 이용 목적, 보유 기간 및 보호 조치를 안내합니다.",
};

const ENFORCED = "2026년 11월 18일";

const COLLECT = [
  {
    when: "회원가입 및 로그인",
    items: "이메일, 비밀번호, 닉네임, 이름(선택)",
    why: "회원 식별 및 본인 확인, 로그인, 그룹 내 이용자 표시",
    keep: "회원 탈퇴 시까지 (탈퇴 즉시 파기)",
  },
  {
    when: "카카오·구글 계정 로그인",
    items:
      "소셜 계정 고유번호, 닉네임, 프로필 이미지, 이메일(제공에 동의한 경우)",
    why: "소셜 계정을 통한 로그인 및 계정 연동",
    keep: "회원 탈퇴 또는 연동 해제 시까지",
  },
  {
    when: "그룹 및 채팅 이용",
    items: "그룹 이름·소개, 구성원 정보, 채팅 메시지, 첨부한 사진 및 파일",
    why: "그룹 구성원 간 대화 및 자료 공유",
    keep: "그룹 존속 기간 (회원 탈퇴 후에도 채팅 기록은 '탈퇴한 사용자'로 표시되어 유지)",
  },
  {
    when: "약속, 투표 및 가능 일정 이용",
    items: "약속 제목·장소·일시, 투표 항목 및 선택 내용, 참여 가능 일자",
    why: "약속 일정 조율 및 지난 약속 기록 제공",
    keep: "그룹 존속 기간",
  },
  {
    when: "약속 장소 추천 이용",
    items: "구성원이 입력한 출발지의 명칭·주소·좌표",
    why: "구성원의 이동시간을 비교하여 만남 장소를 산출",
    keep: "출발지 변경·삭제 시까지 (회원 탈퇴 시 삭제)",
  },
  {
    when: "사진 및 추억 지도 이용",
    items: "업로드한 사진, 사진 설명, 촬영 장소(선택) 및 해당 좌표",
    why: "그룹 사진첩 및 추억 지도 제공",
    keep: "삭제 시까지 (회원 탈퇴 후에도 사진은 그룹에 유지되며 업로더는 '탈퇴한 사용자'로 표시)",
  },
  {
    when: "위치 공유(Meet Mode) 이용",
    items: "현재 위치를 약 500m 격자로 변환한 값, 공유 시작 및 만료 시각",
    why: "약속 당일 구성원 간 도착 현황 제공",
    keep: "공유 중단 즉시 또는 공유 시작 후 10분 경과 시 삭제",
  },
  {
    when: "서비스 이용 과정에서 자동 생성",
    items: "로그인 세션 정보(암호화된 값)",
    why: "로그인 상태 유지",
    keep: "7일 또는 로그아웃 시까지",
  },
];

const OUTSOURCE = [
  {
    who: "Supabase",
    what: "데이터베이스 운영 및 사진 파일 보관",
    data: "제1항의 수집 항목 전체",
  },
  {
    who: "카카오",
    what: "소셜 로그인, 지도·장소 검색, 대중교통 경로 조회",
    data: "로그인 정보, 검색어, 출발지 및 도착지 좌표",
  },
  { who: "구글", what: "소셜 로그인", data: "로그인 정보" },
  {
    who: "TMAP, 공공데이터포털(TAGO)",
    what: "대중교통 및 시외교통 이동시간 산출",
    data: "출발지 및 후보 장소 좌표",
  },
];

export default function PrivacyPage() {
  return (
    <main className={css.page}>
      <nav className={css.top}>
        <Link href="/">MeetMap 홈으로</Link>
      </nav>

      <header className={css.head}>
        <h1>개인정보 처리방침</h1>
        <p className={css.lead}>
          MeetMap(이하 &quot;서비스&quot;)은 이용자의 개인정보를 중요하게
          생각하며, 「개인정보 보호법」 등 관련 법령을 준수하기 위하여
          노력합니다. 본 방침을 통하여 서비스가 처리하는 개인정보의 항목, 이용
          목적, 보유 기간 및 보호 조치를 안내합니다.
        </p>
        <p className={css.meta}>시행일자: {ENFORCED}</p>
      </header>

      <section className={css.toc} aria-label="목차">
        <ol>
          <li>수집하는 개인정보의 항목, 이용 목적 및 보유 기간</li>
          <li>개인정보의 제3자 제공</li>
          <li>개인정보 처리의 위탁</li>
          <li>개인정보의 파기</li>
          <li>개인정보의 안전성 확보 조치</li>
          <li>이용자의 권리와 행사 방법</li>
          <li>개인정보 처리방침의 변경</li>
        </ol>
      </section>

      <section className={css.block}>
        <h2>1. 수집하는 개인정보의 항목, 이용 목적 및 보유 기간</h2>
        <p>
          서비스는 다음과 같이 개인정보를 처리하며, 명시한 목적 이외의 용도로는
          이용하지 않습니다.
        </p>
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>구분</th>
                <th>수집 항목</th>
                <th>이용 목적</th>
                <th>보유 및 이용 기간</th>
              </tr>
            </thead>
            <tbody>
              {COLLECT.map((row) => (
                <tr key={row.when}>
                  <td data-label="구분">{row.when}</td>
                  <td data-label="수집 항목">{row.items}</td>
                  <td data-label="이용 목적">{row.why}</td>
                  <td data-label="보유 및 이용 기간">{row.keep}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={css.note}>
          수집한 개인정보는 광고 또는 마케팅 목적으로 이용하지 않습니다. 이메일
          및 이름은 같은 그룹의 다른 구성원에게 공개되지 않으며, 그룹 내에서는
          닉네임이 표시됩니다.
        </p>
      </section>

      <section className={css.block}>
        <h2>2. 개인정보의 제3자 제공</h2>
        <p>
          서비스는 이용자의 개인정보를 제1항에서 명시한 범위를 넘어 이용하거나
          제3자에게 제공하지 않습니다. 다만 법령에 근거하거나 수사기관이 법령에
          정해진 절차와 방법에 따라 요구하는 경우에는 예외로 합니다.
        </p>
      </section>

      <section className={css.block}>
        <h2>3. 개인정보 처리의 위탁</h2>
        <p>
          서비스는 원활한 운영을 위하여 다음과 같이 개인정보 처리 업무를 외부
          서비스에 위탁하거나 이를 이용합니다.
        </p>
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>수탁자</th>
                <th>위탁 업무</th>
                <th>제공되는 개인정보</th>
              </tr>
            </thead>
            <tbody>
              {OUTSOURCE.map((row) => (
                <tr key={row.who}>
                  <td data-label="수탁자">{row.who}</td>
                  <td data-label="위탁 업무">{row.what}</td>
                  <td data-label="제공되는 개인정보">{row.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={css.note}>
          수탁자의 서버는 국외에 위치할 수 있습니다. 수탁자가 변경되는 경우 본
          방침을 통하여 안내합니다.
        </p>
      </section>

      <section className={css.block}>
        <h2>4. 개인정보의 파기</h2>
        <ul>
          <li>
            이용자가 회원 탈퇴를 요청하면 이메일, 이름, 비밀번호, 프로필 사진,
            위치 정보, 출발지 정보, 로그인 세션 및 소셜 계정 연동 정보를 지체
            없이 파기합니다.
          </li>
          <li>
            그룹 구성원 간 대화의 연속성을 위하여 채팅 및 투표 기록은 삭제하지
            않고 작성자를 &quot;탈퇴한 사용자&quot;로 표시합니다. 이용자가
            업로드한 사진은 그룹에 유지되며 업로더는 &quot;탈퇴한 사용자&quot;로
            표시됩니다.
          </li>
          <li>
            위치 공유 정보는 이용자가 공유를 중단하거나 공유 시작 후 10분이
            경과하면 서버에서 자동으로 삭제합니다.
          </li>
        </ul>
      </section>

      <section className={css.block}>
        <h2>5. 개인정보의 안전성 확보 조치</h2>
        <ul>
          <li>
            비밀번호는 복호화가 불가능한 단방향 암호화 방식(argon2id)으로
            저장하며, 서비스 운영자도 원문을 알 수 없습니다.
          </li>
          <li>
            로그인 세션은 자바스크립트로 접근할 수 없는 쿠키에 저장하며,
            서버에는 암호화된 값만 저장합니다.
          </li>
          <li>
            모든 그룹 기능은 서버에서 로그인 여부와 그룹 구성원 여부를 확인하여
            접근을 통제합니다.
          </li>
          <li>
            사진은 비공개 저장소에 보관하며, 열람 시 유효시간이 제한된 임시
            주소를 발급합니다.
          </li>
          <li>
            파일 업로드 시 확장자, 파일 내용 및 용량을 검증하며 실행 파일은
            허용하지 않습니다.
          </li>
          <li>
            로그인 및 회원가입 시도 횟수를 제한하여 무차별 대입 공격을
            방지합니다.
          </li>
          <li>
            외부 사이트에서 발생한 비정상적인 요청(CSRF)은 요청 출처를 검증하여
            차단합니다.
          </li>
          <li>
            위치 정보는 정확한 좌표가 아닌 약 500m 격자 단위로 변환하여
            공유합니다.
          </li>
        </ul>
      </section>

      <section className={css.block}>
        <h2>6. 이용자의 권리와 행사 방법</h2>
        <p>이용자는 언제든지 다음의 권리를 행사할 수 있습니다.</p>
        <ul>
          <li>
            개인정보의 열람 및 정정: 설정 메뉴에서 닉네임과 프로필 사진을 직접
            수정할 수 있습니다.
          </li>
          <li>
            출발지 및 위치 정보의 삭제: 이용자가 직접 삭제하거나 위치 공유를
            중단할 수 있습니다.
          </li>
          <li>
            회원 탈퇴 및 개인정보 삭제:{" "}
            <Link href="/settings">설정의 회원 탈퇴</Link> 메뉴에서 직접 요청할
            수 있습니다.
          </li>
        </ul>
      </section>

      <section className={css.block}>
        <h2>7. 개인정보 처리방침의 변경</h2>
        <p>
          본 방침의 내용이 추가, 삭제 또는 수정되는 경우 변경 사항을 본 페이지를
          통하여 사전에 공지하며, 변경된 방침의 시행일자를 함께 표시합니다.
        </p>
        <p className={css.meta}>공고일자 및 시행일자: {ENFORCED}</p>
      </section>
    </main>
  );
}
