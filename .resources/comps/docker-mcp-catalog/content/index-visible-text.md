Insights on the state of AI agents from 800+ builders and leaders. Download your copy
✕
Home
/
Manuals
/
MCP Catalog and Toolkit
/
Catalog
Docker MCP Catalog
Table of contents
What's in the catalog
Local versus remote servers
Browse the catalog
Add servers to a profile
Custom catalogs
Custom catalogs with Dynamic MCP
Import a custom catalog
Create and manage custom catalogs
Contribute an MCP server to the catalog
Availability:
Beta 

The Docker MCP Catalog is a curated collection of verified MCP servers, packaged as Docker images and distributed through Docker Hub. It solves common challenges with running MCP servers locally: environment conflicts, setup complexity, and security concerns.

The catalog serves as the source of available MCP servers. When you add servers to your profiles, you select them from the catalog. Each server runs as an isolated container, making it portable and consistent across different environments.

Note

E2B sandboxes now include direct access to the Docker MCP Catalog, giving developers access to over 200 tools and services to seamlessly build and run AI agents. For more information, see E2B Sandboxes.

What's in the catalog

The Docker MCP Catalog includes:

Verified servers: All servers are versioned with full provenance and SBOM metadata
Partner tools: Servers from New Relic, Stripe, Grafana, and other trusted partners
Docker-built servers: Locally-running servers built and digitally signed by Docker for enhanced security
Remote services: Cloud-hosted servers that connect to external services like GitHub, Notion, and Linear
Local versus remote servers

The catalog contains two types of servers based on where they run:

Local servers run as containers on your machine. They work offline once downloaded and offer predictable performance and complete data privacy. Docker builds and signs all local servers in the catalog.

Remote servers run on the provider's infrastructure and connect to external services. Many remote servers use OAuth authentication, which the MCP Toolkit handles automatically through your browser.

Browse the catalog

Browse available MCP servers at hub.docker.com/mcp or directly in Docker Desktop:

In Docker Desktop, select MCP Toolkit.
Select the Catalog tab to browse available servers.
Select a server to view its description, tools, and configuration options.
Add servers to a profile

To add a server from the catalog to a profile:

In the Catalog tab, select the checkbox next to a server.
Choose the profile to add it to from the drop-down.

For step-by-step instructions and client connection, see Get started with MCP Toolkit or MCP Profiles.

Custom catalogs

Custom catalogs let you curate focused collections of servers for your team or organization. Instead of exposing all 300+ servers in the Docker catalog, you define exactly which servers are available.

Common use cases:

Restrict which servers your organization approves for use
Add your organization's private MCP servers alongside public ones
Control which server versions your team uses
Define the server set available to AI agents using Dynamic MCP
Custom catalogs with Dynamic MCP

Custom catalogs work particularly well with Dynamic MCP, where agents discover and add MCP servers on-demand during conversations. When you run the gateway with a custom catalog, the mcp-find tool searches only within that catalog. If your catalog contains 20 servers instead of 300+, agents work within that focused set, discovering and enabling tools as needed without manual configuration each time.

Import a custom catalog

If someone on your team has created and published a catalog, you can import it using its OCI registry reference.

In Docker Desktop:

Select MCP Toolkit and select the Catalog tab.
Select Import catalog.
Enter the OCI reference for the catalog (for example, registry.example.com/mcp/team-catalog:latest).
Select Import.

Using the CLI:

$ docker mcp catalog pull <oci-reference>


Once imported, the catalog appears alongside the Docker catalog and you can add its servers to your profiles.

Create and manage custom catalogs

Creating and managing custom catalogs requires the CLI. See Custom catalogs in the CLI how-to for step-by-step instructions, including:

Curating a subset of the Docker catalog
Adding private servers to a catalog
Building a focused catalog from scratch
Pushing a catalog to a registry for your team to import
Contribute an MCP server to the catalog

The MCP server registry is available at https://github.com/docker/mcp-registry. To submit an MCP server, follow the contributing guidelines.

When your pull request is reviewed and approved, your MCP server is available within 24 hours on:

Docker Desktop's MCP Toolkit feature.
The Docker MCP Catalog.
The Docker Hub mcp namespace (for MCP servers built by Docker).
Copyright © 2013-2026 Docker Inc. All rights reserved.
Give feedback
Was this page useful?
Select an option from 1 to 5, with 1 being Hate and 5 being Love
Hate
Love
Next
