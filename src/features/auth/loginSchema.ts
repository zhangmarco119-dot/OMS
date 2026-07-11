import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, '请输入账号名或姓名').max(100, '账号名或姓名过长'),
  password: z.string().min(1, '请输入密码'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
