export default function SideNotes() {
  return (
    <>
      <div className="side-bubble bubble-right" style={{ top: 30, right: "calc(50% + 560px)" }}>
        Most fraud systems ignore this: blocking good customers costs merchants ~9x more than the fraud they catch.
      </div>
      <div className="side-bubble bubble-left" style={{ top: 380, left: "calc(50% + 560px)" }}>
        Same transactions, two strategies. One scores by dollar cost, the other by a fixed probability cutoff.
      </div>
      <div className="side-bubble bubble-right" style={{ top: 980, right: "calc(50% + 560px)" }}>
        This only works if our cost assumptions are roughly right — here's how wrong they'd have to be to break it.
      </div>
    </>
  );
}
