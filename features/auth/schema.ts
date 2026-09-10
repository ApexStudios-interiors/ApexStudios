import { z } from "zod";

export const staffLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Enter your password"),
});

export const magicLinkSchema = z.object({
  email: z.email(),
});

export const totpVerifySchema = z.object({
  factorId: z.string().min(1),
  challengeId: z.string().min(1),
  code: z.string().length(6, "Enter the 6-digit code"),
});
