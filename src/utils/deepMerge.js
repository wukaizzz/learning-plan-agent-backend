function isMergeableObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base = {}, updates = {}) {
  if (!isMergeableObject(updates)) {
    return base;
  }

  const merged = Array.isArray(base) ? [...base] : { ...(isMergeableObject(base) ? base : {}) };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }

    if (isMergeableObject(value) && isMergeableObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export default deepMerge;
