import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertySection } from "./PropertySection";

describe("PropertySection", () => {
  it("renders title and children when defaultOpen", () => {
    const html = renderToStaticMarkup(
      <PropertySection title="属性">
        <span data-testid="child">hi</span>
      </PropertySection>,
    );
    expect(html).toContain("属性");
    expect(html).toContain('data-testid="child"');
  });

  it("hides children when defaultOpen=false", () => {
    const html = renderToStaticMarkup(
      <PropertySection title="折叠" defaultOpen={false}>
        <span data-testid="hidden">hidden</span>
      </PropertySection>,
    );
    expect(html).not.toContain('data-testid="hidden"');
  });
});
