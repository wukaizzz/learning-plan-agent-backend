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

export const PlanningSeedSchema = z.object({
  goal: z.object({
    primaryGoal: z.string().optional(),
    examDate: z.string().optional(),
    targetScore: z.number().optional(),
    priority: z.number().min(1).max(10).optional(),
  }).optional(),
  subjects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    currentLevel: z.number().min(1).max(10).optional(),
    targetLevel: z.number().min(1).max(10).optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    weakPoints: z.array(z.string()).optional(),
  })).optional(),
  availability: z.object({
    dailyHours: z.number().optional(),
    preferredSlots: z.array(z.string()).optional(),
    unavailableDates: z.array(z.string()).optional(),
    examDistance: z.number().optional(),
  }).optional(),
});

export const ToolCallDecisionSchema = z.object({
  toolName: z.enum(['calculator', 'weather', 'web_search']),
  parameters: z.record(z.string(), z.any()).default({}),
  reason: z.string().optional(),
});

export const SupervisorIntentDecisionSchema = z.object({
  intent: z.enum([
    'general_chat',
    'initial_planning',
    'tool_assisted_answer',
    'query_plan',
    'adjust_plan',
    'replan',
    'clarification',
    'unknown'
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  certainty: z.enum(['high', 'medium', 'low']).optional(),
  shouldUseTools: z.boolean().default(false),
  toolCalls: z.array(ToolCallDecisionSchema).default([]),
  planningSeed: PlanningSeedSchema.optional(),
  responseGuidance: z.string().optional(),
});

export default {
  RiskAssessmentSchema,
  TaskFrameworkSchema,
  PlanningSeedSchema,
  ToolCallDecisionSchema,
  SupervisorIntentDecisionSchema,
};
