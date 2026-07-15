# Persona patterns — bilingual sycophancy / apology / trailer / echo / leak dictionary

bao 2026-06-06. This file is the i18n source of truth for the deterministic
post-process filter in `messageEndHandler`. Bridge reads it at startup, parses
each `## Section` header into a category, and builds regex from each `- bullet`.

The `.md` location intentionally sidesteps the "all source code English"
hard rule in `.kiro/steering/development-philosophy.md` — patterns must include native-language LLM outputs to
catch them.

Each pattern is a literal phrase. The handler builds an anchored regex
(start-of-content for preambles, end-of-content for trailers, anywhere
for leaks). All matches are case-insensitive where applicable. Order
within a section matters: longer phrases first so they match before
substrings.

## Sycophancy preambles (en)

- Great question
- That's a great question
- That is a great question
- Excellent question
- Sure
- Of course
- Absolutely
- I'd be happy to
- I would be happy to
- Happy to help
- Let me think
- Hmm, let me

## Sycophancy preambles (zh)

- 这是一个很不错的想法
- 这是一个不错的想法
- 这是个很不错的想法
- 这是个不错的想法
- 这是一个好的方向
- 这是个好的方向
- 这是一个很好的问题
- 这是一个好问题
- 这是个好问题
- 好问题
- 当然
- 没问题
- 没错

## Apology preambles (en)

- Sorry for the confusion
- Sorry about that
- Apologies for the confusion
- Apologies
- My apologies
- I apologize
- I'm sorry
- I am sorry

## Apology preambles (zh)

- 非常抱歉
- 抱歉之前的错误
- 抱歉
- 对不起
- 不好意思
- 真的对不起

## Trailers (en)

- Let me know if you need more help
- Let me know if you have any questions
- Let me know if you need anything else
- Feel free to ask
- Hope this helps
- Hope that helps
- Happy to help further

## Trailers (zh)

- 如果你还有问题可以随时告诉我
- 如果你需要更多帮助请告诉我
- 如果你需要更多帮助
- 如果还需要帮助
- 希望对你有帮助
- 希望这对你有帮助
- 还有什么问题可以随时问我
- 还有其他问题可以告诉我
- 可以随时问我

## Echo prefixes (zh)

- 关于你提到的
- 关于你说的
- 按照你说的
- 如你所说
- 你想

## Internal name leaks (any)

These do not get stripped — they get REPLACED with a generic brand-safe
phrase. Format: `pattern -> replacement` per bullet.

- Pi RpcClient -> the brain
- Pi process -> the brain
- Pi agent -> the brain
- provider router -> the provider
- MCP server -> the tool layer
- MCP client -> the tool layer
- MCP bus -> the tool layer
- kernel registry -> CTRL
- kernel substrate -> CTRL
- ctrl-pi-bridge -> the brain
- pi-coding-agent -> the brain

## Planner scaffolds (en)

Detected as a whole-message pattern (Goal/Progress/Done/Next Steps
heading sequence). The handler removes them and emits a one-line
replacement asking Pi to retry without scaffolding. Not regex-driven
from this file — listed here for documentation only.

- Goal: ... / Progress: ... / Done: ... / Next Steps: ...
- ## Goal / ## Progress / ## Done / ## Next Steps
