import { z } from "zod";

export const SignalsSchema = z.object({
  company: z.string().min(1),
  industry: z.string().min(1),
  pain_points: z.array(z.string()).min(1),
  use_cases: z.array(z.string()).min(1),
  objections: z.array(z.string()),
  tools: z.array(z.string()),
}).strict();

export type Signals = z.infer<typeof SignalsSchema>;

export const SlideSchema = z.object({
  slide_number: z.number(),
  title: z.string(),
  talking_points: z.array(z.string()),
  features: z.array(z.string()),
  sources: z.array(z.string()),
  grounding_status: z.enum(["grounded", "needs_review"]).optional(),
});

export type Slide = z.infer<typeof SlideSchema>;

export const DeckSchema = z.object({
  deal_id: z.string(),
  company: z.string(),
  slides: z.array(SlideSchema),
});

export type Deck = z.infer<typeof DeckSchema>;

export const EvalRequestSchema = z.object({
  edited_deck: DeckSchema,
});

export type StreamEvent =
  | { type: "stage"; stage: string; message: string }
  | { type: "slide"; slide: Slide }
  | { type: "error"; message: string }
  | { type: "complete"; deal_id: string; faithfulness_rate: number };
