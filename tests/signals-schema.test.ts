import { describe, it, expect } from "vitest";
import { SignalsSchema } from "@/lib/schemas";

describe("SignalsSchema", () => {
  const validSignals = {
    company: "Acme Corp",
    industry: "Financial Services",
    pain_points: ["No audit trail", "Manual document review"],
    use_cases: ["Contract analysis", "Compliance monitoring"],
    objections: ["Data residency concerns"],
    tools: ["Salesforce", "SharePoint"],
  };

  it("accepts valid input", () => {
    expect(() => SignalsSchema.parse(validSignals)).not.toThrow();
  });

  it("rejects missing required fields", () => {
    const { company: _company, ...rest } = validSignals;
    expect(() => SignalsSchema.parse(rest)).toThrow();
  });

  it("rejects wrong types", () => {
    expect(() => SignalsSchema.parse({ ...validSignals, pain_points: "string instead of array" })).toThrow();
  });

  it("rejects empty company string", () => {
    expect(() => SignalsSchema.parse({ ...validSignals, company: "" })).toThrow();
  });

  it("rejects empty required arrays", () => {
    expect(() => SignalsSchema.parse({ ...validSignals, pain_points: [] })).toThrow();
  });

  it("rejects extra fields", () => {
    expect(() => SignalsSchema.parse({ ...validSignals, extraField: "nope" })).toThrow();
  });
});
