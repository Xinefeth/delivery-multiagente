import Anthropic from '@anthropic-ai/sdk';

const claudeClient = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export default claudeClient;
