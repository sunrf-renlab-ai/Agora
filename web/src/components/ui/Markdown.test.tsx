import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders bold text via <strong>", () => {
    render(<Markdown source="**hello**" />);
    expect(screen.getByText("hello").tagName).toBe("STRONG");
  });

  it("strips <script> tags via DOMPurify", () => {
    const { container } = render(<Markdown source={"plain<script>window.x=1</script>text"} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders headers and lists (gfm)", () => {
    const { container } = render(<Markdown source={"# Title\n- a\n- b"} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders empty for null source", () => {
    const { container } = render(<Markdown source={null} />);
    expect(container.firstChild).toBeNull();
  });
});
