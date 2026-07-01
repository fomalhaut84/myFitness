// 임시 디자인 프리뷰 라우트 — 이슈 #168 트레이닝 플랜 UI 시안.
// 승인되면 이 폴더 삭제하고 /training-plan 정식 구현으로 교체.

// @ts-expect-error prototype.jsx 는 docs/ 하위라 TS include 밖. dev 서버 런타임은 정상 해석.
import Prototype from "../../../../docs/designs/168-training-plan-ui/prototype.jsx";

export default function Page() {
  return <Prototype />;
}
