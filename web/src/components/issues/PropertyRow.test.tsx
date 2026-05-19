import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyRow } from "./PropertyRow";

describe("PropertyRow", () => {
  it("renders label and string value", () => {
    const html = renderToStaticMarkup(<PropertyRow label="状态" value="进行中" />);
    expect(html).toContain("状态");
    expect(html).toContain("进行中");
  });

  it("renders ReactNode value verbatim", () => {
    const html = renderToStaticMarkup(
      <PropertyRow label="负责人" value={<span data-testid="who">Runfeng</span>} />,
    );
    expect(html).toContain('data-testid="who"');
    expect(html).toContain("Runfeng");
  });
});
