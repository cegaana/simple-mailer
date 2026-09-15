import { describe, it, expect } from "vitest";
import { escapeHtml, extractVariables, inspectVariables, renderMessage, renderString } from "../src/template.js";
import type { MailerTemplate } from "../src/types.js";

const template: MailerTemplate = {
  id: "t1",
  slug: "speaker-invite",
  name: "Speaker invite",
  subject: "Invitation for {{ first_name }}",
  bodyHtml: "<p>Dear {{ first_name | default('Friend') }}, welcome to {{ event_name }}.</p>",
  bodyText: "Dear {{ first_name | default('Friend') }}, welcome to {{ event_name }}.",
};

describe("renderString", () => {
  it("interpolates a value", () => {
    expect(renderString("Hello {{ name }}", { name: "Charlie" })).toBe("Hello Charlie");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderString("Hello {{name}}", { name: "Charlie" })).toBe("Hello Charlie");
  });

  it("falls back to a default when the value is missing or empty", () => {
    expect(renderString("Hi {{ name | default('Friend') }}", {})).toBe("Hi Friend");
    expect(renderString("Hi {{ name | default('Friend') }}", { name: "" })).toBe("Hi Friend");
    expect(renderString("Hi {{ name | default('Friend') }}", { name: null })).toBe("Hi Friend");
  });

  it("renders numbers and booleans, since CSV data is not all strings", () => {
    expect(renderString("Class of {{ grad_year }}", { grad_year: 1988 })).toBe("Class of 1988");
    expect(renderString("VIP: {{ vip }}", { vip: true })).toBe("VIP: true");
  });

  it("walks dotted paths without throwing on a missing hop", () => {
    expect(renderString("{{ a.b.c }}", { a: { b: { c: "deep" } } })).toBe("deep");
    expect(renderString("{{ a.b.c }}", { a: null })).toBe("");
  });

  it("substitutes empty for a missing variable, or throws in strict mode", () => {
    expect(renderString("Hi {{ nope }}", {})).toBe("Hi ");
    expect(() => renderString("Hi {{ nope }}", {}, { strict: true })).toThrow(/nope/);
  });
});

describe("renderMessage", () => {
  it("escapes merge data in HTML and leaves the text body literal", () => {
    const data = { first_name: "<script>alert(1)</script>", event_name: "CEG & Co" };
    const rendered = renderMessage(template, template.subject, data);

    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).toContain("CEG &amp; Co");
    expect(rendered.html).not.toContain("<script>");

    expect(rendered.text).toContain("<script>alert(1)</script>");
    expect(rendered.text).toContain("CEG & Co");
  });

  it("renders the subject from the campaign, not the template", () => {
    const rendered = renderMessage(template, "Briefing for {{ first_name }}", {
      first_name: "Charlie",
    });
    expect(rendered.subject).toBe("Briefing for Charlie");
  });

  it("survives a recipient with no metadata at all", () => {
    const rendered = renderMessage(template, template.subject, {});
    expect(rendered.text).toBe("Dear Friend, welcome to .");
  });
});

describe("helpers", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("lists every distinct placeholder", () => {
    expect(extractVariables(template.bodyHtml, template.subject))
      .toEqual(["event_name", "first_name"]);
  });

  it("inspects placeholders and detects defaults correctly", () => {
    const inspected = inspectVariables(template.bodyHtml, template.subject);
    expect(inspected).toEqual([
      { name: "event_name", hasDefault: false, defaultValue: undefined },
      // Notice: in bodyHtml first_name has default 'Friend', but in subject it has no default, so overall hasDefault is false
      { name: "first_name", hasDefault: false, defaultValue: undefined },
    ]);

    const onlyDefault = inspectVariables("<p>{{ city | default('SF') }}</p>");
    expect(onlyDefault).toEqual([
      { name: "city", hasDefault: true, defaultValue: "SF" },
    ]);
  });
});
