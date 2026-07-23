import { z } from 'zod';

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
});

export const chatRequestSchema = z.object({
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  messages: z.array(chatMessageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32_000).optional(),
});

export const embeddingsRequestSchema = z.object({
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type EmbeddingsRequestInput = z.infer<typeof embeddingsRequestSchema>;
