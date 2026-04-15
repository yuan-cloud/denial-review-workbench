import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("renders a React component in jsdom", () => {
    render(<div>harness works</div>);
    expect(screen.getByText("harness works")).toBeInTheDocument();
  });
});
