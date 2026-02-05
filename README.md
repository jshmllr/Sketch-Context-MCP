> [!NOTE]
> This repository has been archived as of February 5, 2026. Please refer to the official Sketch MCP at [https://www.sketch.com/docs/mcp-server/](https://www.sketch.com/docs/mcp-server/)

> **Note:** This project was currently in dev/testing phase and was not fully stable.

# Sketch Context MCP

<a href="https://glama.ai/mcp/servers/@jshmllr/Sketch-Context-MCP">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@jshmllr/Sketch-Context-MCP/badge" />
</a>

A Model Context Protocol (MCP) server for integrating Sketch designs with IDEs such as Cursor, Cline, or Windsurf.

## Overview

This tool allows Cursor IDE to access and interpret Sketch design files, enabling AI-powered design-to-code workflows. It works by:

1. Providing a server that parses Sketch files (.sketch)
2. Implementing the MCP protocol that Cursor or other IDEs use for context
3. Allowing you to reference specific components and layers from your Sketch files
4. Providing a UI interface for Sketch that communicates with Cursor
5. Enabling real-time bidirectional communication between Sketch and Cursor

## Components

This project consists of two main components:

1. **MCP Server**: A Node.js server that implements the Model Context Protocol to provide Sketch file data to Cursor IDE
2. **Sketch Plugin**: A Sketch plugin with UI interface that communicates with the MCP server via WebSockets

## Available MCP Tools

The server provides the following tools to Cursor:

- `get_file`: Retrieve contents of a Sketch file or specific node within it
- `list_components`: List all components/symbols in a Sketch file
- `get_selection`: Get information about currently selected elements
- `create_rectangle`: Create new rectangles with specified dimensions and properties
- `create_text`: Create new text elements with custom content and styling

These tools enable Cursor to:
- Access and inspect Sketch design files
- Query specific components and layers
- Create and modify design elements through natural language commands
- Maintain real-time synchronization with Sketch

## Supported Features

- Local and Cloud Sketch file parsing
- Component/Symbol extraction
- Asset management and automatic downloads
- Selection links support via the Sketch plugin
- Real-time updates via WebSockets and SSE
- Interactive UI for connecting Sketch to Cursor
- Parsing both local and Sketch Cloud-hosted files
- Extracting document structure and component information
- Accessing specific nodes by ID
- Listing all components in a Sketch file
- Creating rectangles, text and other elements via commands from Cursor

## UI & Experience Principles

Review the [Accessible, Fast, Delightful UI Principles](docs/ui-principles.md) before shipping changes to the plugin or MCP UI. The guide enumerates the MUST/SHOULD/NEVER rules for interaction patterns, accessibility, performance, and visual design to keep user experiences inclusive and resilient.

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- Sketch (v70 or later)
- Cursor IDE, VS Code or similar
- A Sketch account (local) or use API access (Sketch Cloud files)

### Installation

```bash
# Install globally
npm install -g sketch-context-mcp

# Run with a local Sketch file
sketch-context-mcp --local-file=/path/to/your/file.sketch

# Run with Sketch Cloud access
sketch-context-mcp --sketch-api-key=<your-sketch-api-key>
```

Or run directly with npx:

```bash
npx sketch-context-mcp --local-file=/path/to/your/file.sketch
```

### Installing the Sketch Plugin

1. Download the latest release of the plugin from the [releases page](https://github.com/jshmllr/sketch-context-mcp/releases)
2. Double-click the `.sketchplugin` file to install it in Sketch
3. The plugin will be available in Sketch under Plugins > Sketch Context MCP

### Integration with Cursor

To use this with Cursor:

1. Start the MCP server with your Sketch file:
   ```bash
   sketch-context-mcp --local-file=/path/to/your/file.sketch
   ```

2. In Sketch, open the plugin:
   - Go to Plugins > Sketch Context MCP > Open MCP Interface
   - Enter the server port (default: 3333)
   - Click "Connect"

3. In Cursor, connect to the MCP server:
   - Go to Settings > Features > Context
   - Add a new MCP server with the URL: `http://localhost:3333/sse`
   - Click "Connect"

4. In the Cursor composer, you can now:
   - Reference components by ID: "Show me the component with ID 12345"
   - List all components: "List all components in the design"
   - Get details about specific elements: "Describe the button in the header"
   - Create new elements: "Create a rectangle with width 200 and height 100"

## Obtaining a Sketch API Key

The Sketch API key is an OAuth access token required for accessing Sketch Cloud-hosted files. Follow these steps to obtain and use the token:

### Step 1: Authenticate with Sketch Cloud
Use your Sketch Cloud credentials (email and password) to generate an access token by making a POST request to the authentication endpoint:

```bash
curl -X "POST" "https://auth.sketch.cloud/oauth/token" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "YOUR_EMAIL",
    "password": "YOUR_PASSWORD",
    "grant_type": "password"
  }'
```

Replace `YOUR_EMAIL` and `YOUR_PASSWORD` with your Sketch Cloud account credentials.

### Step 2: Access Token
The response will include an `access_token`. This token serves as your API key for accessing Sketch Cloud-hosted files.

### Step 3: Using the Token

For security, it is recommended to pass the token as an environment variable:

```bash
export SKETCH_API_KEY=<your-access-token>
```

Or include it as a command-line argument:

```bash
sketch-context-mcp --sketch-api-key=<your-access-token>
```

### Step 4: Refreshing the Token
If your token expires, use the `refresh_token` provided in the initial response to obtain a new access token.

### Security Best Practices

To ensure your API key is secure, follow these guidelines:

- **Do Not Hard-Code the Key**: Never hard-code an API key into the application or source code. Instead, use environment variables or secret management tools.
- **Use .env Files for Local Development**: Store your API key in a `.env` file and load it using a library like `dotenv`:

  ```
  SKETCH_API_KEY=<your-access-token>
  ```

  Ensure the `.env` file is added to `.gitignore` to avoid accidental exposure.
- **Rotate Tokens Regularly**: If your token is leaked or compromised, revoke it and generate a new one immediately.
- **Monitor and Audit**: Use tools to scan your repository for exposed credentials (e.g., GitHub’s secret scanning feature).
- **Use Short-Lived Tokens**: If possible, use short-lived tokens and refresh them as needed to minimize the impact of a leaked token.

### How It Works in Sketch-Context-MCP

The Sketch API key is required for accessing Sketch Cloud-hosted files. The server uses this key to authenticate requests to Sketch Cloud and retrieve the necessary design data. The key is passed securely via the `Authorization` header when making API requests.

## Configuration

The server can be configured using either environment variables (via `.env` file) or command-line arguments. Command-line arguments take precedence over environment variables.

### Environment Variables

* `SKETCH_API_KEY`: Your Sketch API access token (required for Sketch Cloud files)
* `PORT`: The port to run the server on (default: 3333)
* `LOCAL_SKETCH_PATH`: Path to local Sketch file (alternative to --local-file argument)
* `DEBUG_LEVEL`: Set logging verbosity (default: 'info')

### Command-line Arguments

* `--version`: Show version number
* `--sketch-api-key`: Your Sketch API access token
* `--port`: The port to run the server on
* `--stdio`: Run the server in command mode, instead of default HTTP/SSE
* `--help`: Show help menu

## Using the Sketch Plugin

### Connection Tab

The Connection tab allows you to connect to the Sketch Context MCP server:

1. Enter the port number (default is 3333)
2. Click "Connect" to establish a WebSocket connection
3. Once connected, you'll see a confirmation message with the channel ID
4. Follow the instructions for connecting Cursor to the server

### Selection Tab

The Selection tab displays information about selected layers in your Sketch document:

1. Select one or more layers in your Sketch document
2. The selected layers will be displayed in the list
3. Click "Copy Selection IDs" to copy the layer IDs to your clipboard
4. Use these IDs in Cursor to reference specific layers

### About Tab

The About tab provides information about the plugin and how to use it.

## Using with Cursor

Once both Sketch and Cursor are connected to the MCP server:

1. Select elements in Sketch
2. Copy their IDs using the Sketch Context MCP plugin
3. In Cursor, reference these elements by their IDs

Example commands in Cursor:

- "Show me the details of the layer with ID 12345"
- "Create a blue rectangle with width 300 and height 200"
- "Add a text layer with the content 'Hello World'"

## Troubleshooting

### Common Issues

- **Connection Errors**: Make sure your server is running and the port is accessible
- **Authentication Failures**: Verify your Sketch API key is correct
- **File Parsing Issues**: Ensure your Sketch file is valid and not corrupted
- **WebSocket Connection Failed**: Ensure the port is not blocked by a firewall

### Logs

To enable detailed logging, set the DEBUG environment variable:

```bash
DEBUG=sketch-mcp:* npx sketch-context-mcp
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
