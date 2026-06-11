Gmail MCP for AI Agents
Securely connect your AI agents and chatbots (Claude, ChatGPT, Cursor, etc) with Gmail MCP or direct API to read, send, search, and label emails through natural language.
TRUSTED BY
GET STARTED FOR FREE
GET A DEMO

30 min · no commitment · see it on your stack

Try Gmail now
MARKDOWN
▾

Enter a prompt below to test the integration in our Tool Router playground. You'll be redirected to sign in and try it live.

Summarize unread emails from this morning
Create draft replies to urgent messages
Fetch contact details for recent senders
Add 'Follow Up' label to flagged emails
Supported Tools and Triggers
Tools
Triggers
Modify email labels
Adds and/or removes specified Gmail labels for a message; ensure `message_id` and all `label_ids` are valid (use 'listLabels' for custom label IDs).
Batch delete Gmail messages
Tool to permanently delete multiple Gmail messages in bulk, bypassing Trash with no recovery possible.
Batch modify Gmail messages
Modify labels on multiple Gmail messages in one efficient API call.
Create email draft
Creates a Gmail email draft.
Create Gmail filter
Tool to create a new Gmail filter with specified criteria and actions.
Create label
Creates a new label with a unique name in the specified user's Gmail account.
Create Prompt Post
Send a one-shot prompt to the Sanity Content Agent.
Delete Draft
Permanently deletes a specific Gmail draft using its ID with no recovery possible; verify the correct `draft_id` and obtain explicit user confirmation before calling.
Delete Gmail filter
Tool to permanently delete a Gmail filter by its ID.
Delete label from account (permanent)
Permanently DELETES a user-created Gmail label from the account (not from a message).
Delete message
Permanently deletes a specific email message by its ID from a Gmail mailbox; for `user_id`, use 'me' for the authenticated user or an email address to which the authenticated user has delegated access.
Delete thread
Tool to immediately and permanently delete a specified thread and all its messages.
Fetch emails
Fetches a list of email messages from a Gmail account, supporting filtering, pagination, and optional full content retrieval.
Fetch message by message ID
Fetches a specific email message by its ID, provided the `message_id` exists and is accessible to the authenticated `user_id`.
Fetch Message by Thread ID
Retrieves messages from a Gmail thread using its `thread_id`, where the thread must be accessible by the specified `user_id`.
Forward email message
Forward an existing Gmail message to specified recipients, preserving original body and attachments.
Get Gmail attachment
Retrieves a specific attachment by ID from a message in a user's Gmail mailbox, requiring valid message and attachment IDs.
Get Auto-Forwarding Settings
Tool to get the auto-forwarding setting for the specified account.
Get contacts
Fetches contacts (connections) for the authenticated Google account, allowing selection of specific data fields and pagination.
Get Draft
Retrieves a single Gmail draft by its ID.
Get Gmail filter
Tool to retrieve a specific Gmail filter by its ID.
Get label details
Gets details for a specified Gmail label.
Get Language Settings
Tool to retrieve the language settings for a Gmail user.
Get People
Retrieves either a specific person's details (using `resource_name`) or lists 'Other Contacts' (if `other_contacts` is true), with `person_fields` specifying the data to return.
Get Profile
Retrieves Gmail profile information (email address, aggregate messagesTotal/threadsTotal, historyId) for a user.
Get Vacation Settings
Tool to retrieve vacation responder settings for a Gmail user.
Import message
Tool to import a message into the user's mailbox with standard email delivery scanning and classification.
Insert message into mailbox
Tool to insert a message into the user's mailbox similar to IMAP APPEND.
List CSE identities
Tool to list client-side encrypted identities for an authenticated user.
List CSE key pairs
Tool to list client-side encryption key pairs for an authenticated user.
List Drafts
Retrieves a paginated list of email drafts from a user's Gmail account.
List Gmail filters
Tool to list all Gmail filters (rules) in the mailbox.
List forwarding addresses
Tool to list all forwarding addresses for the specified Gmail account.
List Gmail history
Tool to list Gmail mailbox change history since a known startHistoryId.
List Gmail labels
Retrieves all system and user-created labels for a Gmail account in a single unpaginated response.
List send-as aliases
Lists the send-as aliases for a Gmail account, including the primary address and custom 'from' aliases.
List S/MIME configs
Lists S/MIME configs for the specified send-as alias.
List threads
Retrieves a list of email threads from a Gmail account, identified by `user_id` (email address or 'me'), supporting filtering and pagination.
Modify thread labels
Adds or removes specified existing label IDs from a Gmail thread, affecting all its messages; ensure the thread ID is valid.
Trash thread
Moves the specified thread to the trash.
Move to Trash
Moves an existing, non-deleted email message to the trash for the specified user.
Patch Label
Patches the specified user-created label.
Patch send-as alias
Tool to patch the specified send-as alias for a Gmail user.
Reply to email thread
Sends a reply within a specific Gmail thread using the original thread's subject; do not provide a custom subject as it will start a new conversation instead of replying in-thread.
Search People
Searches contacts by matching the query against names, nicknames, emails, phone numbers, and organizations, optionally including 'Other Contacts'.
Send Draft
Sends an existing draft email AS-IS to recipients already defined within the draft.
Send Email
Sends an email via Gmail API using the authenticated user's Google profile display name.
Get IMAP Settings
Retrieves the IMAP settings for a Gmail user account, including whether IMAP is enabled, auto-expunge behavior, expunge behavior, and maximum folder size.
Get POP settings
Tool to retrieve POP settings for a Gmail account.
Get send-as alias
Tool to retrieve a specific send-as alias configuration for a Gmail user.
Stop watch notifications
Tool to stop receiving push notifications for a Gmail mailbox.
Untrash Message
Tool to remove a message from trash in Gmail.
Untrash thread
Tool to remove a thread from trash in Gmail.
Update draft
Updates (replaces) an existing Gmail draft's content in-place by draft ID.
Update IMAP settings
Tool to update IMAP settings for a Gmail account.
Update Label
Tool to update the properties of an existing Gmail label.
Update Language Settings
Tool to update the language settings for a Gmail user.
Update POP settings
Tool to update POP settings for a Gmail account.
Update send-as alias
Tool to update a send-as alias for a Gmail user.
Update User Attributes Values
Update user attribute values for a resource.
Update Vacation Settings
Tool to update vacation responder settings for a Gmail user.
Connect Gmail MCP Tool with your Agent
Python
TypeScript
Install Composio
PYTHON
COPY
pip install composio claude-agent-sdk
Install the Composio SDK and Claude Agent SDK
Create Tool Router Session
PYTHON
COPY
from composio import Composio
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

composio = Composio(api_key='your-composio-api-key')
session = composio.create(user_id='your-user-id')
url = session.mcp.url
Initialize the Composio client and create a Tool Router session
Connect to AI Agent
PYTHON
COPY
import asyncio

options = ClaudeAgentOptions(
    permission_mode='bypassPermissions',
    mcp_servers={
        'tool_router': {
            'type': 'http',
            'url': url,
            'headers': {
                'x-api-key': 'your-composio-api-key'
            }
        }
    },
    system_prompt='You are a helpful assistant with access to Gmail tools.',
    max_turns=10
)

async def main():
    async with ClaudeSDKClient(options=options) as client:
        await client.query('Summarize unread emails from this morning')
        async for message in client.receive_response():
            if hasattr(message, 'content'):
                for block in message.content:
                    if hasattr(block, 'text'):
                        print(block.text)

asyncio.run(main())
Use the MCP server with your AI agent
Connect Gmail API Tool with your Agent
Why Use Composio?
AI Native Gmail Integration
Supports both Gmail MCP and direct API based integrations
Structured, LLM-friendly schemas for reliable tool execution
Rich coverage for reading, writing, and querying your Gmail data
Managed Auth
Built-in OAuth handling with automatic token refresh and rotation
Central place to manage, scope, and revoke Gmail access
Per user and per environment credentials instead of hard-coded keys
Agent Optimized Design
Tools are tuned using real error and success rates to improve reliability over time
Comprehensive execution logs so you always know what ran, when, and on whose behalf
Enterprise Grade Security
Fine-grained RBAC so you control which agents and users can access Gmail
Scoped, least privilege access to Gmail resources
Full audit trail of agent actions to support review and compliance
Use Gmail with any AI Agent Framework

Choose a Framework you want to connect Gmail with

ChatGPT

Use Gmail MCP with ChatGPT

Antigravity

Use Gmail MCP with Antigravity

OpenAI Agents SDK

Use Gmail MCP with OpenAI Agents SDK

Claude Agents SDK

Use Gmail MCP with Claude Agents SDK

Claude Code

Use Gmail MCP with Claude Code

Claude Cowork

Use Gmail MCP with Claude Cowork

Codex

Use Gmail MCP with Codex

Cursor

Use Gmail MCP with Cursor

VS Code

Use Gmail MCP with VS Code

OpenCode

Use Gmail MCP with OpenCode

OpenClaw

Use Gmail MCP with OpenClaw

Hermes

Use Gmail MCP with Hermes

CLI

Use Gmail MCP with CLI

Google ADK

Use Gmail MCP with Google ADK

Langchain

Use Gmail MCP with Langchain

AI SDK

Use Gmail MCP with AI SDK

Mastra AI

Use Gmail MCP with Mastra AI

LlamaIndex

Use Gmail MCP with LlamaIndex

CrewAI

Use Gmail MCP with CrewAI

Pydantic AI

Use Gmail MCP with Pydantic AI

Autogen

Use Gmail MCP with Autogen

Explore Other Toolkits
Outlook
OAUTH2
S2S OAUTH2

Outlook is Microsoft's email and calendaring platform for unified communications and scheduling. It helps users stay organized with powerful email, contacts, and calendar management.

Slack
OAUTH2

Slack is a channel-based messaging platform for teams and organizations. It helps people collaborate in real time, share files, and connect all their tools in one place.

Gong
BASIC
OAUTH2

Gong is a platform for video meetings, call recording, and team collaboration. It helps teams capture conversations, analyze calls, and turn insights into action.

LOAD MORE
TOOLKIT MARKETPLACE
Frequently Asked Questions
Do I need my own developer credentials to use Gmail with Composio?
No, you can get started immediately using Composio's built-in Gmail app. For production, we recommend configuring your own OAuth credentials.
Can I use multiple toolkits together?
Yes! Composio's Tool Router enables agents to use multiple toolkits. Learn more.
Is Composio secure?
Composio is SOC 2 and ISO 27001 compliant with all data encrypted in transit and at rest. Learn more.
What if the API changes?
Composio maintains and updates all toolkit integrations automatically, so your agents always work with the latest API versions.
Used by agents from
Never worry about agent reliability

We handle tool reliability, observability, and security so you never have to second-guess an agent action.

GET STARTED FOR FREE
GET A DEMO
↗
HARSHA GADDIPATI
Co-founder, Slashy

Karan skipped his own birthday party to fix our critical issue. It was 10 pm and he diverted his Waymo to help us instead. This really sets the bar, shows you the commitment you need to have when users rely on your software.

ABHI ARYA
Co-founder, Opennote

A lot of students tell us that the moment their connected tools start talking to each other inside Opennote feels almost magical. The agent just knows them, and it has immensely helped in keeping new users on the platform.

NIRMAN DAVE
CEO, Zams

We chose Composio over Pipedream because it delivered depth where it mattered. It supported niche tools and tricky edge cases that other platforms simply ignored. Giving us confidence to scale without compromising.

RYAN YU
Founder, Extra Thursday

As a solo builder, shipping fast is life or death. The only way I can outcompete incumbents is by outmanoeuvring them. Getting bogged down in the complexities of managing agent auth would have been a death sentence for Extra Thursday.

TOMISIN JENROLA
Founder & CEO, SwarmZero

Before partnering with Composio, adding tool integrations was a slow, resource-intensive process. Each integration could take weeks or months of engineering time, and maintaining them meant constantly keeping up with API changes.

JEROME LECLANCHE
Co-Founder, Ingram Technologies

With hands-on help from their founder, we integrated Gmail and Google Drive in just 30 minutes. This level of personal support and commitment is exactly what startups should strive for.

HARSHA GADDIPATI
Co-founder, Slashy

Karan skipped his own birthday party to fix our critical issue. It was 10 pm and he diverted his Waymo to help us instead. This really sets the bar, shows you the commitment you need to have when users rely on your software.

ABHI ARYA
Co-founder, Opennote

A lot of students tell us that the moment their connected tools start talking to each other inside Opennote feels almost magical. The agent just knows them, and it has immensely helped in keeping new users on the platform.

NIRMAN DAVE
CEO, Zams

We chose Composio over Pipedream because it delivered depth where it mattered. It supported niche tools and tricky edge cases that other platforms simply ignored. Giving us confidence to scale without compromising.

RYAN YU
Founder, Extra Thursday

As a solo builder, shipping fast is life or death. The only way I can outcompete incumbents is by outmanoeuvring them. Getting bogged down in the complexities of managing agent auth would have been a death sentence for Extra Thursday.

TOMISIN JENROLA
Founder & CEO, SwarmZero

Before partnering with Composio, adding tool integrations was a slow, resource-intensive process. Each integration could take weeks or months of engineering time, and maintaining them meant constantly keeping up with API changes.

JEROME LECLANCHE
Co-Founder, Ingram Technologies

With hands-on help from their founder, we integrated Gmail and Google Drive in just 30 minutes. This level of personal support and commitment is exactly what startups should strive for.

HARSHA GADDIPATI
Co-founder, Slashy

Karan skipped his own birthday party to fix our critical issue. It was 10 pm and he diverted his Waymo to help us instead. This really sets the bar, shows you the commitment you need to have when users rely on your software.

ABHI ARYA
Co-founder, Opennote

A lot of students tell us that the moment their connected tools start talking to each other inside Opennote feels almost magical. The agent just knows them, and it has immensely helped in keeping new users on the platform.

NIRMAN DAVE
CEO, Zams

We chose Composio over Pipedream because it delivered depth where it mattered. It supported niche tools and tricky edge cases that other platforms simply ignored. Giving us confidence to scale without compromising.

RYAN YU
Founder, Extra Thursday

As a solo builder, shipping fast is life or death. The only way I can outcompete incumbents is by outmanoeuvring them. Getting bogged down in the complexities of managing agent auth would have been a death sentence for Extra Thursday.

TOMISIN JENROLA
Founder & CEO, SwarmZero

Before partnering with Composio, adding tool integrations was a slow, resource-intensive process. Each integration could take weeks or months of engineering time, and maintaining them meant constantly keeping up with API changes.

JEROME LECLANCHE
Co-Founder, Ingram Technologies

With hands-on help from their founder, we integrated Gmail and Google Drive in just 30 minutes. This level of personal support and commitment is exactly what startups should strive for.

Composio
Composio
Stay updated.
JOIN DISCORD

PRODUCT

ENTERPRISE
PRICING
AGENT AUTH

RESOURCES

DOCS
BLOG
OAUTH2 GUIDES
CASE STUDIES

COMPANY

CAREERS
TRUST
SUPPORT
TERMS
PRIVACY POLICY

© Composio 2026
