Toggle navigation menu
Awesome Skills
Back to Skills
agent-browser

Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction.

28,079
stars
1,699
forks
Updated 4/8/2026
Productivity & Workflow
Testing & QA
#web-scraping
#cli
#testing
#browser-automation
#javascript
#automation
Details
SKILL.md
Security Assessment
Low Risk
(85/100)

Detected risks:

Secret Exposure([SKILL.md] API_KEY=)
Security Score
85/100
About agent-browser

The agent-browser skill provides a browser automation CLI designed for AI agents to interact with websites. It allows users to automate various browser tasks such as navigating pages, filling out forms, clicking buttons, taking screenshots, scraping data, and testing web applications. The skill is particularly useful for automating repetitive browser tasks or for AI-driven agents that need to perform tasks in a browser without manual intervention. By leveraging direct control over Chrome/Chromium via the Chrome DevTools Protocol (CDP), the agent-browser enables programmatic web interaction with minimal setup or dependencies.

The main features of the agent-browser skill include the ability to open websites, take snapshots of page elements, interact with elements like filling forms or clicking buttons, and take screenshots or capture data from web pages. It supports command chaining, allowing multiple commands to be executed in sequence efficiently. The skill offers several methods for handling authentication, including importing authentication states from the user’s browser, reusing Chrome profiles, and using persistent profiles for recurring tasks. It also supports session management through session names that automatically save and restore cookies and localStorage data. This makes it a powerful tool for automating both simple and complex web interactions in a seamless manner.

This skill is ideal for developers, QA engineers, and automation enthusiasts who need to streamline their browser interactions. It’s particularly useful for tasks that involve form submissions, web scraping, web testing, or logging into websites. Whether you're working on automating user behavior testing, scraping data from dynamic websites, or performing repetitive tasks like logging into web apps, agent-browser provides an efficient and flexible solution.

FAQ
How do I install the agent-browser skill?

You can install the agent-browser skill via several methods: `npm i -g agent-browser`, `brew install agent-browser`, or `cargo install agent-browser`. After installation, run `agent-browser install` to download Chrome.

Can I use agent-browser with existing Chrome or Brave installations?

Yes, agent-browser can automatically detect existing Chrome, Brave, Playwright, and Puppeteer installations, so you don't need to install a separate browser if you already have one of these installed.

How does session management work in agent-browser?

Agent-browser supports session management through session names, which allow automatic saving and restoring of cookies and localStorage data. This means you can save the authentication state of a session and use it in future runs without needing to log in again.

What authentication methods are supported?

Agent-browser supports multiple authentication methods including importing auth from the user’s browser, reusing Chrome profiles, using persistent profiles for recurring tasks, and storing session data in an auth vault for easy retrieval.

Are there any limitations on using agent-browser with different websites?

There are no inherent limitations in the agent-browser skill for interacting with websites. However, some websites may have additional protections like CAPTCHA or advanced anti-bot measures that could prevent automated interactions. These require additional handling or workarounds.

All Files
11 files
references/session-management.md
4.2 KB
View
templates/capture-workflow.sh
1.8 KB
View
references/authentication.md
8.2 KB
View
references/commands.md
11.2 KB
View
references/snapshot-refs.md
5.2 KB
View
templates/form-automation.sh
1.8 KB
View
references/profiling.md
3.3 KB
View
references/video-recording.md
3.5 KB
View
SKILL.md
33.2 KB
View
references/proxy-support.md
4.9 KB
View
templates/authenticated-session.sh
3.6 KB
View
Install agent-browser
Download ZIP
Git Clone
Download and extract the skill files to your .claude/skills/ directory.
Download ZIP

Quick Setup:

Copy the skill folder to .claude/skills/
Claude will automatically detect and use the skill

Repository

vercel-labs/agent-browser
Related Skills

mom-test

1,254

ux-copy

20,028

engineering-skills

17,711

streaming

16

Awesome Skills

Discover Open-Source Agent Skills for AI Coding Assistants

PRODUCT
Search
Category
Tag
Blog
RESOURCES
Claude Skill Docs
Antigravity Skills Docs
TOOLS
Claude Code
OpenCode
Cursor
Codex
Antigravity
COMPANY
Privacy Policy
Terms of Service
Sitemap

©2026 Awesome Skills. All rights reserved.

Privacy Policy
Terms
