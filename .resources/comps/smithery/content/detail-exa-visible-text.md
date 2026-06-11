Exa Search
exa
last deployed 13 days ago
Add to toolbox
90/100
23.3k calls
99.82% uptime

Fast, intelligent web search and web crawling. Get fresh information about libraries, APIs, and SDKs.

2
1
1
web_search_exa
READ-ONLY

Search the web for any topic and get clean, ready-to-use content.

Best for: Finding current information, news, facts, people, companies, or answering questions about any topic.
Returns: Clean text content from top search results.

Query tips:
describe the ideal page, not keywords. "blog post comparing React and Vue performance" not "React vs Vue".
Use category:people / category:company to search through Linkedin profiles / companies respectively.
If highlights are insufficient, follow up with web_fetch_exa on the best URLs.

web_fetch_exa
READ-ONLY

Read a webpage's full content as clean markdown. Use after web_search_exa when highlights are insufficient or to read any URL.

Best for: Extracting full content from known URLs. Batch multiple URLs in one call.
Returns: Clean text content and metadata from the page(s).

Repository
github.com/exa-labs/exa-mcp-server
Homepage
exa.ai
Published
Dec 13, 2024
License
MIT
Tool Calls
23,081
Performance
Tool
Calls
web_search_exa
20,612
web_fetch_exa
2,590
crawling_exa
93
get_code_context_exa
40
search
4
web-search-exa
3
web_search_advanced_exa
3
get_summary
1
company_research_exa
1
Total
23,347
Uptime (30d)
99.8%
Latency (30d)
143ms p50
May 11
May 21
May 29
Jun 10
0ms
150ms
300ms
450ms
600ms
Usage
Top Clients
1
Claude Code
13,401
2
Cursor
10,167
3
Smithery
9,398
4
Codex
9,046
5
M
MCP Remote Test
4,666
Total
62,681
Daily Sessions
May 11
May 23
Jun 1
Jun 10
0
2,500
5,000
7,500
10,000
Integrate

Integrate this server via the CLI, MCP SDK, or AI SDK. Smithery handles OAuth, token refresh, and session management for you.

Create API key
Manage Connections
CLI
AI SDK
TypeScript
PREVIEW

1. Install Smithery CLI

npm install -g smithery

2. Create a namespace

smithery namespace create {your-namespace}

3. Use this server

# Add this server
smithery mcp add exa

# List available tools
smithery tool list {connection}

# Call a tool
smithery tool call {connection} {tool_name} '{"key": "value"}'

Give agents more agency

Resources
Documentation
Privacy Policy
System Status
Company
Pricing
About
Blog
Connect

© 2026 Smithery. All rights reserved.

Jun 1
