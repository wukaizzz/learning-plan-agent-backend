/**
 * LLM 输出的 Zod Schema 定义
 * 用于 withStructuredOutput 的结构化校验
 * 遵循 PROJECT_RULES: Agent 输出必须是结构化 JSON + Zod 校验
 */

import { z } from 'zod';

export const RiskFactorSchema = z.object({
  type: z.enum(['time_pressure', 'low_accuracy', 'falling_behind', 'resource_overload']),
  description: z.string(),
  severity: z.number().min(1).max(10),
});

export const RiskAssessmentSchema = z.object({
  level: z.enum(['low', 'medium', 'high', 'critical']),
  factors: z.array(RiskFactorSchema),
  prediction: z.string(),
  suggestedActions: z.array(z.string()),
  timeAssessment: z.enum(['sufficient', 'tight', 'insufficient']),
  subjectPriorities: z.array(z.object({
    subjectName: z.string(),
    priorityLevel: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  })),
  strategy: z.string(),
});

export const TaskFrameworkItemSchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  title: z.string(),
  type: z.enum(['study', 'practice', 'review']),
  priority: z.number().min(1).max(10),
  estimatedHours: z.number(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
});

export const TaskFrameworkSchema = z.object({
  tasks: z.array(TaskFrameworkItemSchema),
  strategy: z.string(),
  totalEstimatedHours: z.number(),
  phaseBreakdown: z.array(z.object({
    phase: z.string(),
    description: z.string(),
    dayRange: z.string(),
  })).optional(),
});

export default {
  RiskAssessmentSchema,
  TaskFrameworkSchema,
};
