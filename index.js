#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const dotenv = require('dotenv');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const readline = require('readline');
const tmp = require('tmp');
const { createServer } = require('http');
const WebSocket = require('ws');

// Load environment variables from .env file
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('sketch-api-key', {
    description: 'Your Sketch API access token',
    type: 'string',
  })
  .option('port', {
    description: 'The port to run the server on',
    type: 'number',
    default: 3333,
  })
  .option('stdio', {
    description: 'Run the server in command mode, instead of default HTTP/SSE',
    type: 'boolean',
    default: false,
  })
  .option('local-file', {
    description: 'Path to a local Sketch file to serve',
    type: 'string',
  })
  .help()
  .version()
  .alias('help', 'h')
  .argv;

// Configuration variables
const config = {
  sketchApiKey: argv['sketch-api-key'] || process.env.SKETCH_API_KEY,
  port: argv.port || process.env.PORT || 3333,
  isStdioMode: argv.stdio || false,
  localFilePath: argv['local-file'] || process.env.LOCAL_SKETCH_PATH,
};

// Initialize Express app
const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(bodyParser.json());

// WebSocket channels and clients
const channels = new Map();
const clients = new Set();
const pendingRequests = new Map();

// Initialize WebSocket server
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
    
    // Remove client from all channels
    for (const [channelName, channelClients] of channels.entries()) {
      if (channelClients.has(ws)) {
        channelClients.delete(ws);
        if (channelClients.size === 0) {
          channels.delete(channelName);
        }
      }
    }
  });

  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to Sketch MCP server'
  }));
});

// Handle WebSocket messages
function handleWebSocketMessage(ws, data) {
  console.log('Received WebSocket message:', data);

  // Handle joining a channel
  if (data.type === 'join') {
    const channelName = data.channel;
    if (!channelName) {
      return ws.send(JSON.stringify({
        type: 'error',
        message: 'Channel name is required'
      }));
    }

    // Create the channel if it doesn't exist
    if (!channels.has(channelName)) {
      channels.set(channelName, new Set());
    }

    // Add the client to the channel
    channels.get(channelName).add(ws);

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'system',
      channel: channelName,
      message: { result: true }
    }));

    console.log(`Client joined channel: ${channelName}`);
    return;
  }

  // Handle messages to be forwarded to a channel
  if (data.type === 'message' && data.channel) {
    const channelName = data.channel;
    const channelClients = channels.get(channelName);

    if (!channelClients) {
      return ws.send(JSON.stringify({
        type: 'error',
        message: 'Channel not found'
      }));
    }

    // Store request ID if present for response routing
    if (data.id) {
      pendingRequests.set(data.id, ws);
      
      // Set timeout to clean up pending requests after 30 seconds
      setTimeout(() => {
        if (pendingRequests.has(data.id)) {
          pendingRequests.delete(data.id);
        }
      }, 30000);
    }

    // Forward the message to all clients in the channel except the sender
    channelClients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'message',
          channel: channelName,
          message: data.message
        }));
      }
    });

    return;
  }
  
  // Handle command execution responses
  if (data.id && pendingRequests.has(data.id)) {
    const requester = pendingRequests.get(data.id);
    pendingRequests.delete(data.id);
    
    if (requester && requester.readyState === WebSocket.OPEN) {
      requester.send(JSON.stringify({
        id: data.id,
        type: 'message',
        result: data.result,
        error: data.error
      }));
    }
    
    return;
  }

  // Unknown message type
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Unknown message type or format'
  }));
}

// SSE endpoint for Cursor to connect to
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Add this client to our connected clients
  clients.add(res);
  
  // Remove client when they disconnect
  req.on('close', () => {
    clients.delete(res);
  });
  
  // Send initial connection successful message
  res.write(`data: ${JSON.stringify({ type: 'connection_success' })}\n\n`);
});

// MCP Tools registration
const TOOLS = [
  {
    name: 'get_file',
    description: 'Get the contents of a Sketch file',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to a Sketch file or Sketch Cloud document',
        },
        nodeId: {
          type: 'string',
          description: 'Optional. ID of a specific node within the document to retrieve',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_components',
    description: 'List all components in a Sketch file',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to a Sketch file or Sketch Cloud document',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_selection',
    description: 'Get information about selected elements in a Sketch document',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to the Sketch document',
        },
        selectionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of selected element IDs from the Sketch Selection Helper plugin',
        }
      },
      required: ['url', 'selectionIds'],
    },
  },
  {
    name: 'create_rectangle',
    description: 'Create a new rectangle in the Sketch document',
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X position of the rectangle'
        },
        y: {
          type: 'number',
          description: 'Y position of the rectangle'
        },
        width: {
          type: 'number',
          description: 'Width of the rectangle'
        },
        height: {
          type: 'number',
          description: 'Height of the rectangle'
        },
        color: {
          type: 'string',
          description: 'Fill color of the rectangle (hex format)'
        }
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'create_text',
    description: 'Create a new text layer in the Sketch document',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text content'
        },
        x: {
          type: 'number',
          description: 'X position of the text layer'
        },
        y: {
          type: 'number',
          description: 'Y position of the text layer'
        },
        fontSize: {
          type: 'number',
          description: 'Font size'
        },
        color: {
          type: 'string',
          description: 'Text color (hex format)'
        }
      },
      required: ['text'],
    },
  }
];

// Handler for messages endpoint
app.post('/messages', async (req, res) => {
  try {
    const message = req.body;
    
    if (message.type === 'ping') {
      return res.json({ type: 'pong' });
    }
    
    if (message.type === 'get_tools') {
      return res.json({
        type: 'tools',
        tools: TOOLS,
      });
    }
    
    if (message.type === 'execute_tool') {
      const { tool, params } = message;
      let result;
      
      if (tool === 'get_file') {
        result = await getSketchFile(params.url, params.nodeId);
      } else if (tool === 'list_components') {
        result = await listSketchComponents(params.url);
      } else if (tool === 'get_selection') {
        result = await getSketchSelection(params.url, params.selectionIds);
      } else if (tool === 'create_rectangle') {
        result = await forwardToWebSocketClients('create_rectangle', params);
      } else if (tool === 'create_text') {
        result = await forwardToWebSocketClients('create_text', params);
      } else {
        return res.status(400).json({
          type: 'error',
          error: `Unknown tool: ${tool}`,
        });
      }
      
      return res.json({
        type: 'tool_result',
        id: message.id,
        result,
      });
    }
    
    return res.status(400).json({
      type: 'error',
      error: `Unknown message type: ${message.type}`,
    });
  } catch (error) {
    console.error('Error processing message:', error);
    return res.status(500).json({
      type: 'error',
      error: error.message,
    });
  }
});

// Forward a command to all connected WebSocket clients
async function forwardToWebSocketClients(command, params) {
  return new Promise((resolve, reject) => {
    if (clients.size === 0) {
      return reject(new Error('No connected Sketch instances'));
    }
    
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    let responseReceived = false;
    
    // Store the request handlers
    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout: setTimeout(() => {
        if (!responseReceived) {
          pendingRequests.delete(requestId);
          reject(new Error('Request timed out'));
        }
      }, 30000)
    });
    
    // Send to all WebSocket clients in all channels
    for (const [channelName, channelClients] of channels.entries()) {
      channelClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'message',
            channel: channelName,
            message: {
              id: requestId,
              command,
              params
            }
          }));
        }
      });
    }
  });
}

// Main endpoint for basic info
app.get('/', (req, res) => {
  res.send(`
    <h1>Sketch MCP Server</h1>
    <p>Server is running!</p>
    <p>SSE endpoint available at <a href="/sse">http://localhost:${config.port}/sse</a></p>
    <p>Message endpoint available at http://localhost:${config.port}/messages</p>
    <p>WebSocket endpoint available at ws://localhost:${config.port}</p>
  `);
});

// Function to get Sketch file contents
async function getSketchFile(url, nodeId) {
  // Add support for both local and cloud files
  const isCloudUrl = url.includes('sketch.cloud');
  let documentData;
  
  if (isCloudUrl) {
    const documentId = extractDocumentIdFromUrl(url);
    if (!config.sketchApiKey) {
      throw new Error('Sketch API key is required for cloud files');
    }
    documentData = await fetchCloudDocument(documentId);
  } else {
    documentData = await parseLocalSketchFile(url);
  }

  // Add better node traversal and selection support
  if (nodeId) {
    const node = findNodeWithMetadata(documentData, nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    // Include parent context and styling information
    return enrichNodeData(node);
  }

  return documentData;
}

// Function to fetch document from Sketch Cloud
async function fetchCloudDocument(documentId) {
  if (!config.sketchApiKey) {
    throw new Error('Sketch API key is required for cloud files');
  }
  
  // Call Sketch Cloud API to get document details
  const apiUrl = `https://api.sketch.cloud/v1/documents/${documentId}`;
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${config.sketchApiKey}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch document from Sketch Cloud: ${response.statusText}`);
  }
  
  const documentData = await response.json();
  
  // Get the download URL for the sketch file
  const downloadUrl = documentData.shortcut.downloadUrl;
  
  // Download the file
  const fileResponse = await fetch(downloadUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download Sketch file: ${fileResponse.statusText}`);
  }
  
  const buffer = await fileResponse.buffer();
  return parseSketchBuffer(buffer);
}

// Function to parse Sketch file buffer
async function parseSketchBuffer(buffer, nodeId = null) {
  // Create a temporary file to store the buffer
  const tmpFile = tmp.fileSync({ postfix: '.sketch' });
  fs.writeFileSync(tmpFile.name, buffer);
  
  try {
    // Extract the sketch file (it's a zip)
    const zip = new AdmZip(tmpFile.name);
    const entries = zip.getEntries();
    
    // Parse the document.json file
    const documentEntry = entries.find(entry => entry.entryName === 'document.json');
    if (!documentEntry) {
      throw new Error('Invalid Sketch file: document.json not found');
    }
    
    const documentJson = JSON.parse(zip.readAsText(documentEntry));
    
    // Get meta.json for additional info
    const metaEntry = entries.find(entry => entry.entryName === 'meta.json');
    const metaJson = metaEntry ? JSON.parse(zip.readAsText(metaEntry)) : {};
    
    // Parse pages
    const pages = [];
    const pagesEntries = entries.filter(entry => entry.entryName.startsWith('pages/'));
    
    for (const pageEntry of pagesEntries) {
      const pageJson = JSON.parse(zip.readAsText(pageEntry));
      pages.push(pageJson);
    }
    
    // Construct the result
    const result = {
      document: documentJson,
      meta: metaJson,
      pages: pages,
    };
    
    // If nodeId is specified, find the specific node
    if (nodeId) {
      // First check in the document
      let node = findNodeById(documentJson, nodeId);
      
      // If not found, check in pages
      if (!node) {
        for (const page of pages) {
          node = findNodeById(page, nodeId);
          if (node) break;
        }
      }
      
      if (!node) {
        throw new Error(`Node with ID ${nodeId} not found in the document`);
      }
      
      return node;
    }
    
    return result;
  } finally {
    // Clean up
    tmpFile.removeCallback();
  }
}

// Function to list components in a Sketch file
async function listSketchComponents(url) {
  try {
    const sketchData = await getSketchFile(url);
    const components = [];
    
    // Search for components in document
    findComponents(sketchData.document, components);
    
    // Search for components in pages
    for (const page of sketchData.pages) {
      findComponents(page, components);
    }
    
    return components;
  } catch (error) {
    console.error('Error listing components:', error);
    throw error;
  }
}

// Helper function to find components in a Sketch object
function findComponents(obj, components) {
  if (!obj) return;
  
  // Check if the object is a component (Symbol master in Sketch)
  if (obj._class === 'symbolMaster') {
    components.push({
      id: obj.do_objectID,
      name: obj.name,
      type: 'component',
      frame: obj.frame,
    });
  }
  
  // Recursively search for components in layers and other objects
  if (obj.layers && Array.isArray(obj.layers)) {
    for (const layer of obj.layers) {
      findComponents(layer, components);
    }
  }
  
  // Check for artboards, which can contain components
  if (obj.artboards && obj.artboards.objects) {
    for (const artboard of obj.artboards.objects) {
      findComponents(artboard, components);
    }
  }
}

// Helper function to find a node by ID
function findNodeById(obj, id) {
  if (!obj) return null;
  
  // Check if this is the node we're looking for
  if (obj.do_objectID === id) {
    return obj;
  }
  
  // Check in layers
  if (obj.layers && Array.isArray(obj.layers)) {
    for (const layer of obj.layers) {
      const found = findNodeById(layer, id);
      if (found) return found;
    }
  }
  
  // Check in artboards
  if (obj.artboards && obj.artboards.objects) {
    for (const artboard of obj.artboards.objects) {
      const found = findNodeById(artboard, id);
      if (found) return found;
    }
  }
  
  // Check in pages
  if (obj.pages && obj.pages.objects) {
    for (const page of obj.pages.objects) {
      const found = findNodeById(page, id);
      if (found) return found;
    }
  }
  
  return null;
}

// Helper function to extract document ID from Sketch Cloud URL
function extractDocumentIdFromUrl(url) {
  const regex = /sketch\.cloud\/s\/([a-zA-Z0-9]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Function to broadcast messages to all connected SSE clients
function broadcast(message) {
  for (const client of clients) {
    if (client.write) { // SSE client
      client.write(`data: ${JSON.stringify(message)}\n\n`);
    } else if (client.readyState === WebSocket.OPEN) { // WebSocket client
      client.send(JSON.stringify(message));
    }
  }
}

// Check if we should run in stdio mode
if (config.isStdioMode) {
  console.log('Initializing Sketch MCP Server in stdio mode...');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  
  rl.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      let response;
      
      if (message.type === 'ping') {
        response = { type: 'pong' };
      } else if (message.type === 'get_tools') {
        response = {
          type: 'tools',
          tools: TOOLS,
        };
      } else if (message.type === 'execute_tool') {
        const { tool, params } = message;
        let result;
        
        if (tool === 'get_file')
          result = await getSketchFile(params.url, params.nodeId);
        else if (tool === 'list_components')
          result = await listSketchComponents(params.url);
        else if (tool === 'get_selection')
          result = await getSketchSelection(params.url, params.selectionIds);
        else if (tool === 'create_rectangle')
          result = await forwardToWebSocketClients('create_rectangle', params);
        else if (tool === 'create_text')
          result = await forwardToWebSocketClients('create_text', params);
        else
          throw new Error(`Unknown tool: ${tool}`);
        
        response = {
          type: 'tool_result',
          id: message.id,
          result,
        };
      } else {
        throw new Error(`Unknown message type: ${message.type}`);
      }
      
      console.log('Sending response:', response);
      broadcast(response);
    } catch (error) {
      console.error('Error processing message:', error);
      const response = handleError(error);
      console.log('Sending error response:', response);
      broadcast(response);
    }
  });
}

// Add more robust error handling
function handleError(error) {
  return {
    type: 'error',
    error: {
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR',
      details: error.details || {},
      suggestion: getSuggestionForError(error)
    }
  };
}

function getSuggestionForError(error) {
  // Implement logic to generate a suggestion based on the error
  return 'Please try again later or contact support for assistance.';
}

// Add implementation for parseLocalSketchFile
async function parseLocalSketchFile(url) {
  // If url is a local file path, use it directly
  // Otherwise, if we have a default local file configured, use that
  const filePath = url.startsWith('/') || url.includes(':\\') 
    ? url 
    : config.localFilePath;
  
  if (!filePath) {
    throw new Error('No local Sketch file specified. Use --local-file parameter or set LOCAL_SKETCH_PATH environment variable.');
  }
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Local Sketch file not found: ${filePath}`);
  }
  
  // Read the file and parse it
  const buffer = fs.readFileSync(filePath);
  return parseSketchBuffer(buffer);
}

// Helper function to find a node with metadata
function findNodeWithMetadata(obj, nodeId) {
  const node = findNodeById(obj, nodeId);
  if (!node) return null;
  return node;
}

// Helper function to enrich node data with context
function enrichNodeData(node) {
  // Add additional context like parent information, styling, etc.
  return {
    node: node,
    type: node._class,
    metadata: {
      id: node.do_objectID,
      name: node.name,
      class: node._class
    }
  };
}

// Function to get information about selected elements
async function getSketchSelection(url, selectionIds) {
  try {
    // Get the full document data
    const documentData = await getSketchFile(url);
    
    // Find the selected nodes
    const selectedNodes = [];
    
    for (const id of selectionIds) {
      // Search for the node in the document
      const node = findNodeById(documentData, id);
      
      if (node) {
        // Enrich the node with additional context
        selectedNodes.push(enrichNodeData(node));
      }
    }
    
    // Return the selection data
    return {
      url: url,
      selectionCount: selectedNodes.length,
      selectedNodes: selectedNodes,
      missingIds: selectionIds.filter(id => !selectedNodes.some(node => node.metadata.id === id))
    };
  } catch (error) {
    console.error('Error getting selection:', error);
    throw error;
  }
}

httpServer.listen(config.port, () => {
  console.log(`
Sketch Context MCP Server is running on port ${config.port}
HTTP endpoints:
- http://localhost:${config.port} (Info page)
- http://localhost:${config.port}/sse (Server-sent events for Cursor)
- http://localhost:${config.port}/messages (Message endpoint for tools)
WebSocket endpoint:
- ws://localhost:${config.port} (For Sketch plugin connections)

To configure Cursor to use this server:
1. Open Cursor and go to Settings > Features > Context
2. Add an MCP server with the URL: http://localhost:${config.port}/sse
3. Connect the Sketch plugin to this server on port ${config.port}
  `);
});