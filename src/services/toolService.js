const TOOL_WHITELIST = new Set(['calculator', 'weather', 'web_search']);

function tokenizeMathExpression(expression) {
  const input = String(expression || '').replace(/\s+/g, '');
  if (!input) {
    throw new Error('Expression is required');
  }

  const tokens = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\d|\./.test(char)) {
      let number = char;
      index += 1;
      while (index < input.length && /[\d.]/.test(input[index])) {
        number += input[index];
        index += 1;
      }
      if (!/^\d+(\.\d+)?$/.test(number) && !/^\.\d+$/.test(number)) {
        throw new Error(`Invalid number: ${number}`);
      }
      tokens.push({ type: 'number', value: Number(number) });
      continue;
    }

    if ('+-*/()'.includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }

    throw new Error(`Unsupported character: ${char}`);
  }

  return tokens;
}

function parseMathExpression(tokens) {
  let cursor = 0;

  const peek = () => tokens[cursor];
  const consume = (type) => {
    const token = peek();
    if (!token || token.type !== type) {
      throw new Error(`Expected ${type}`);
    }
    cursor += 1;
    return token;
  };

  const parseFactor = () => {
    const token = peek();
    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    if (token.type === '+') {
      consume('+');
      return parseFactor();
    }

    if (token.type === '-') {
      consume('-');
      return -parseFactor();
    }

    if (token.type === 'number') {
      cursor += 1;
      return token.value;
    }

    if (token.type === '(') {
      consume('(');
      const value = parseExpression();
      consume(')');
      return value;
    }

    throw new Error(`Unexpected token: ${token.value}`);
  };

  const parseTerm = () => {
    let value = parseFactor();

    while (peek()?.type === '*' || peek()?.type === '/') {
      const operator = peek().type;
      cursor += 1;
      const right = parseFactor();
      if (operator === '*') {
        value *= right;
      } else {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        value /= right;
      }
    }

    return value;
  };

  const parseExpression = () => {
    let value = parseTerm();

    while (peek()?.type === '+' || peek()?.type === '-') {
      const operator = peek().type;
      cursor += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }

    return value;
  };

  const result = parseExpression();
  if (cursor !== tokens.length) {
    throw new Error(`Unexpected token: ${tokens[cursor].value}`);
  }
  return result;
}

function evaluateArithmeticExpression(expression) {
  return parseMathExpression(tokenizeMathExpression(expression));
}

export const toolCatalog = {
  calculator: {
    name: 'calculator',
    description: 'Evaluate basic arithmetic expressions with numbers, parentheses, and + - * / operators.',
    parameters: {
      expression: 'Arithmetic expression, for example: (30 * 2) / 3'
    },
    execute: async (params = {}) => {
      return { result: evaluateArithmeticExpression(params.expression) };
    }
  },

  weather: {
    name: 'weather',
    description: 'Return mock weather information for a location.',
    parameters: {
      location: 'Location name'
    },
    execute: async (params = {}) => {
      const { location } = params;
      return {
        location,
        temperature: Math.round(20 + Math.random() * 10),
        condition: ['Sunny', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 3)],
        humidity: Math.round(40 + Math.random() * 40)
      };
    }
  },

  web_search: {
    name: 'web_search',
    description: 'Return mock search results for a query.',
    parameters: {
      query: 'Search query'
    },
    execute: async (params = {}) => {
      const { query } = params;
      return {
        query,
        results: [
          { title: `Search result for "${query}"`, url: 'https://example.com' },
          { title: `More information about ${query}`, url: 'https://example.org' }
        ]
      };
    }
  }
};

export function getAvailableTools() {
  return Object.values(toolCatalog).map(({ name, description, parameters }) => ({
    name,
    description,
    parameters
  }));
}

export function isToolAllowed(toolName) {
  return TOOL_WHITELIST.has(toolName);
}

export async function executeToolHandler(toolName, params) {
  if (!isToolAllowed(toolName)) {
    throw new Error(`Tool is not allowed: ${toolName}`);
  }

  const tool = toolCatalog[toolName];
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  return await tool.execute(params || {});
}

export default {
  toolCatalog,
  getAvailableTools,
  isToolAllowed,
  executeToolHandler
};
