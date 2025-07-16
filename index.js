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

// Enhanced error handling system
const ERROR_TYPES = {
  NETWORK: 'network_error',
  AUTH: 'authentication_error',
  FILE: 'file_error',
  VALIDATION: 'validation_error',
  SKETCH: 'sketch_error',
  WEBSOCKET: 'websocket_error'
};

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Configuration object with validation
const configSchema = {
  sketchApiKey: { type: 'string', required: false },
  port: { type: 'number', min: 1000, max: 65535, default: 3333 },
  isStdioMode: { type: 'boolean', default: false },
  localFilePath: { type: 'string', required: false },
  maxFileSize: { type: 'number', default: 100 * 1024 * 1024 }, // 100MB
  logLevel: { type: 'string', enum: Object.keys(LOG_LEVELS), default: 'INFO' },
  healthCheckInterval: { type: 'number', default: 30000 }, // 30 seconds
  wsReconnectAttempts: { type: 'number', default: 5 },
  requestTimeout: { type: 'number', default: 30000 }
};

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
  .option('max-file-size', {
    description: 'Maximum file size to process (in MB)',
    type: 'number',
    default: 100,
  })
  .option('log-level', {
    description: 'Logging level (ERROR, WARN, INFO, DEBUG)',
    type: 'string',
    default: 'INFO',
  })
  .help()
  .version()
  .alias('help', 'h')
  .argv;

// Configuration variables with validation
function validateConfig(config) {
  const errors = [];
  
  if (config.port < 1000 || config.port > 65535) {
    errors.push('Port must be between 1000 and 65535');
  }
  
  if (config.localFilePath && !fs.existsSync(config.localFilePath)) {
    errors.push(`Local file path does not exist: ${config.localFilePath}`);
  }
  
  if (config.maxFileSize < 1 || config.maxFileSize > 1000) {
    errors.push('Max file size must be between 1MB and 1000MB');
  }
  
  if (!Object.keys(LOG_LEVELS).includes(config.logLevel.toUpperCase())) {
    errors.push(`Invalid log level: ${config.logLevel}`);
  }
  
  if (errors.length > 0) {
    throw new ConfigurationError(errors.join(', '));
  }
  
  return config;
}

const config = validateConfig({
  sketchApiKey: argv['sketch-api-key'] || process.env.SKETCH_API_KEY,
  port: argv.port || process.env.PORT || 3333,
  isStdioMode: argv.stdio || false,
  localFilePath: argv['local-file'] || process.env.LOCAL_SKETCH_PATH,
  maxFileSize: (argv['max-file-size'] || 100) * 1024 * 1024, // Convert MB to bytes
  logLevel: (argv['log-level'] || process.env.LOG_LEVEL || 'INFO').toUpperCase(),
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
  wsReconnectAttempts: parseInt(process.env.WS_RECONNECT_ATTEMPTS) || 5,
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000
});

// Enhanced logging system
class Logger {
  constructor(level = 'INFO') {
    this.level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO;
  }
  
  log(level, message, metadata = {}) {
    if (LOG_LEVELS[level] <= this.level) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        ...metadata
      };
      console.log(JSON.stringify(logEntry));
    }
  }
  
  error(message, metadata = {}) {
    this.log('ERROR', message, metadata);
  }
  
  warn(message, metadata = {}) {
    this.log('WARN', message, metadata);
  }
  
  info(message, metadata = {}) {
    this.log('INFO', message, metadata);
  }
  
  debug(message, metadata = {}) {
    this.log('DEBUG', message, metadata);
  }
}

const logger = new Logger(config.logLevel);

// Custom error classes
class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
    this.type = ERROR_TYPES.VALIDATION;
  }
}

class NetworkError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'NetworkError';
    this.type = ERROR_TYPES.NETWORK;
    this.originalError = originalError;
  }
}

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.type = ERROR_TYPES.AUTH;
  }
}

class FileError extends Error {
  constructor(message, filePath = null) {
    super(message);
    this.name = 'FileError';
    this.type = ERROR_TYPES.FILE;
    this.filePath = filePath;
  }
}

class SketchError extends Error {
  constructor(message, sketchOperation = null) {
    super(message);
    this.name = 'SketchError';
    this.type = ERROR_TYPES.SKETCH;
    this.sketchOperation = sketchOperation;
  }
}

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced WebSocket and connection management
const channels = new Map();
const clients = new Set();
const pendingRequests = new Map();
const connectionHealth = new Map();

// Connection health monitoring
class ConnectionHealthMonitor {
  constructor() {
    this.healthChecks = new Map();
    this.interval = null;
  }
  
  start() {
    this.interval = setInterval(() => {
      this.performHealthChecks();
    }, config.healthCheckInterval);
    logger.info('Health monitoring started', { interval: config.healthCheckInterval });
  }
  
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Health monitoring stopped');
    }
  }
  
  performHealthChecks() {
    const now = Date.now();
    for (const [ws, lastSeen] of this.healthChecks.entries()) {
      if (now - lastSeen > config.healthCheckInterval * 2) {
        logger.warn('WebSocket client failed health check', { 
          lastSeen: new Date(lastSeen).toISOString() 
        });
        this.removeUnhealthyClient(ws);
      } else {
        // Send ping to check if client is still responsive
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }
  }
  
  updateClientHealth(ws) {
    this.healthChecks.set(ws, Date.now());
  }
  
  removeUnhealthyClient(ws) {
    this.healthChecks.delete(ws);
    clients.delete(ws);
    
    // Remove from all channels
    for (const [channelName, channelClients] of channels.entries()) {
      if (channelClients.has(ws)) {
        channelClients.delete(ws);
        if (channelClients.size === 0) {
          channels.delete(channelName);
          logger.info('Removed empty channel', { channel: channelName });
        }
      }
    }
  }
}

const healthMonitor = new ConnectionHealthMonitor();

// Initialize WebSocket server with enhanced error handling
const wss = new WebSocket.Server({ 
  server: httpServer,
  perMessageDeflate: false,
  maxPayload: config.maxFileSize
});

wss.on('connection', (ws, req) => {
  const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  logger.info('WebSocket client connected', { clientId });
  
  clients.add(ws);
  healthMonitor.updateClientHealth(ws);
  
  // Enhanced message handling with validation
  ws.on('message', (message) => {
    try {
      healthMonitor.updateClientHealth(ws);
      
      if (message.length > config.maxFileSize) {
        throw new Error('Message too large');
      }
      
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      logger.error('Error processing WebSocket message', { 
        error: error.message, 
        clientId,
        messageLength: message.length 
      });
      
      const errorResponse = createErrorResponse(ERROR_TYPES.WEBSOCKET, error.message, {
        suggestion: 'Check message format and size limits'
      });
      
      sendSafeWebSocketMessage(ws, errorResponse);
    }
  });

  ws.on('close', (code, reason) => {
    logger.info('WebSocket client disconnected', { 
      clientId, 
      code, 
      reason: reason.toString() 
    });
    
    clients.delete(ws);
    healthMonitor.healthChecks.delete(ws);
    
    // Remove client from all channels
    for (const [channelName, channelClients] of channels.entries()) {
      if (channelClients.has(ws)) {
        channelClients.delete(ws);
        if (channelClients.size === 0) {
          channels.delete(channelName);
          logger.info('Removed empty channel', { channel: channelName });
        }
      }
    }
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error', { clientId, error: error.message });
    healthMonitor.removeUnhealthyClient(ws);
  });

  ws.on('pong', () => {
    healthMonitor.updateClientHealth(ws);
  });

  // Send initial connection confirmation with server info
  const welcomeMessage = {
    type: 'connected',
    message: 'Connected to Sketch MCP server',
    serverInfo: {
      version: require('./package.json').version,
      capabilities: ['file_processing', 'component_listing', 'real_time_updates'],
      maxFileSize: config.maxFileSize,
      healthCheckInterval: config.healthCheckInterval
    }
  };
  
  sendSafeWebSocketMessage(ws, welcomeMessage);
});

// Safe WebSocket message sending with error handling
function sendSafeWebSocketMessage(ws, message) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    } else {
      logger.warn('Attempted to send message to closed WebSocket');
      return false;
    }
  } catch (error) {
    logger.error('Failed to send WebSocket message', { error: error.message });
    return false;
  }
}

// Enhanced error response creation
function createErrorResponse(type, message, metadata = {}) {
  return {
    type: 'error',
    errorType: type,
    message,
    timestamp: new Date().toISOString(),
    ...metadata
  };
}

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

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    connections: {
      websocket: clients.size,
      channels: channels.size,
      pending: pendingRequests.size
    },
    config: {
      port: config.port,
      maxFileSize: config.maxFileSize,
      logLevel: config.logLevel,
      hasApiKey: !!config.sketchApiKey,
      hasLocalFile: !!config.localFilePath
    }
  };
  
  res.json(health);
});

// Validation endpoint for configuration
app.get('/validate', (req, res) => {
  const validationResults = {
    timestamp: new Date().toISOString(),
    configuration: {
      port: { valid: true, value: config.port },
      maxFileSize: { valid: true, value: `${config.maxFileSize / 1024 / 1024}MB` },
      logLevel: { valid: true, value: config.logLevel }
    },
    connectivity: {
      websocket: clients.size > 0,
      channels: channels.size > 0
    },
    requirements: {
      sketchApiKey: {
        present: !!config.sketchApiKey,
        required: 'Optional for local files, required for Sketch Cloud'
      },
      localFile: {
        present: !!config.localFilePath,
        valid: config.localFilePath ? fs.existsSync(config.localFilePath) : null,
        path: config.localFilePath
      }
    }
  };
  
  // Add warnings if any
  const warnings = [];
  if (!config.sketchApiKey && !config.localFilePath) {
    warnings.push('No Sketch API key or local file configured');
  }
  if (clients.size === 0) {
    warnings.push('No WebSocket clients connected');
  }
  
  if (warnings.length > 0) {
    validationResults.warnings = warnings;
  }
  
  res.json(validationResults);
});

// Main endpoint for basic info
app.get('/', (req, res) => {
  const stats = {
    connections: clients.size,
    channels: channels.size,
    uptime: Math.floor(process.uptime()),
    memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  };

  res.send(`
    <h1>Sketch MCP Server</h1>
    <p><strong>Status:</strong> Running</p>
    <p><strong>Version:</strong> ${require('./package.json').version}</p>
    <div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px;">
      <h3>Server Statistics</h3>
      <ul>
        <li>Active WebSocket connections: ${stats.connections}</li>
        <li>Active channels: ${stats.channels}</li>
        <li>Uptime: ${stats.uptime} seconds</li>
        <li>Memory usage: ${stats.memory}</li>
      </ul>
    </div>
    <div style="margin: 20px 0;">
      <h3>Available Endpoints</h3>
      <ul>
        <li><a href="/health">Health Check</a> - Server health status</li>
        <li><a href="/validate">Configuration Validation</a> - Check server setup</li>
        <li><a href="/sse">Server-Sent Events</a> - For Cursor IDE integration</li>
        <li>POST /messages - Message endpoint for MCP tools</li>
        <li>WebSocket: ws://localhost:${config.port} - For Sketch plugin</li>
      </ul>
    </div>
    <div style="margin: 20px 0; padding: 15px; background: #e8f4fd; border-radius: 5px;">
      <h3>Setup Instructions</h3>
      <p><strong>For Cursor IDE:</strong> Add MCP server with URL: <code>http://localhost:${config.port}/sse</code></p>
      <p><strong>For Sketch Plugin:</strong> Connect to port <code>${config.port}</code></p>
    </div>
  `);
});

// Enhanced file processing with validation and error handling
async function getSketchFile(url, nodeId) {
  try {
    logger.debug('Processing Sketch file request', { url, nodeId });
    
    // Validate input parameters
    if (!url || typeof url !== 'string') {
      throw new FileError('URL parameter is required and must be a string');
    }
    
    // Determine file source and validate
    const isCloudUrl = url.includes('sketch.cloud') || url.includes('sketch.com');
    const isLocalFile = !isCloudUrl && (url.startsWith('/') || url.includes(':\\'));
    
    if (!isCloudUrl && !isLocalFile && !config.localFilePath) {
      throw new FileError('Invalid URL format. Must be a Sketch Cloud URL or local file path', url);
    }
    
    let documentData;
    let fileSize = 0;
    
    if (isCloudUrl) {
      if (!config.sketchApiKey) {
        throw new AuthenticationError('Sketch API key is required for cloud files. Use --sketch-api-key parameter or set SKETCH_API_KEY environment variable');
      }
      
      const documentId = extractDocumentIdFromUrl(url);
      if (!documentId) {
        throw new FileError('Invalid Sketch Cloud URL format', url);
      }
      
      documentData = await fetchCloudDocument(documentId);
    } else {
      const filePath = isLocalFile ? url : config.localFilePath;
      
      if (!filePath) {
        throw new FileError('No local file specified. Use --local-file parameter or provide a file path');
      }
      
      // Check file existence and size
      if (!fs.existsSync(filePath)) {
        throw new FileError(`File not found: ${filePath}`, filePath);
      }
      
      const stats = fs.statSync(filePath);
      fileSize = stats.size;
      
      if (fileSize > config.maxFileSize) {
        throw new FileError(`File too large: ${Math.round(fileSize / 1024 / 1024)}MB (max: ${Math.round(config.maxFileSize / 1024 / 1024)}MB)`, filePath);
      }
      
      if (fileSize === 0) {
        throw new FileError('File is empty', filePath);
      }
      
      documentData = await parseLocalSketchFile(filePath);
    }
    
    // Log successful file processing
    logger.info('File processed successfully', { 
      url: isCloudUrl ? 'cloud' : 'local',
      fileSize: Math.round(fileSize / 1024),
      hasNodeId: !!nodeId 
    });
    
    // Handle specific node requests
    if (nodeId) {
      const node = findNodeWithMetadata(documentData, nodeId);
      if (!node) {
        throw new SketchError(`Node with ID '${nodeId}' not found in document`, 'node_lookup');
      }
      
      logger.debug('Node found successfully', { nodeId, nodeType: node._class });
      return enrichNodeData(node);
    }
    
    return documentData;
    
  } catch (error) {
    logger.error('Failed to process Sketch file', { 
      url, 
      nodeId, 
      error: error.message,
      errorType: error.type || 'unknown'
    });
    
    // Re-throw with appropriate error type if not already categorized
    if (error instanceof FileError || error instanceof AuthenticationError || error instanceof SketchError) {
      throw error;
    } else {
      throw new FileError(`Failed to process Sketch file: ${error.message}`, url);
    }
  }
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

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  shutdown();
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  shutdown();
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

function shutdown() {
  logger.info('Starting graceful shutdown');
  
  // Stop health monitoring
  healthMonitor.stop();
  
  // Close all WebSocket connections
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Server shutting down');
    }
  });
  
  // Close HTTP server
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 5 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

// Start the server
try {
  httpServer.listen(config.port, () => {
    // Start health monitoring
    healthMonitor.start();
    
    const serverInfo = {
      version: require('./package.json').version,
      port: config.port,
      logLevel: config.logLevel,
      maxFileSize: `${Math.round(config.maxFileSize / 1024 / 1024)}MB`,
      hasApiKey: !!config.sketchApiKey,
      hasLocalFile: !!config.localFilePath,
      endpoints: {
        info: `http://localhost:${config.port}`,
        health: `http://localhost:${config.port}/health`,
        validate: `http://localhost:${config.port}/validate`,
        sse: `http://localhost:${config.port}/sse`,
        messages: `http://localhost:${config.port}/messages`,
        websocket: `ws://localhost:${config.port}`
      }
    };
    
    logger.info('Sketch Context MCP Server started successfully', serverInfo);
    
    // Display startup information
    console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  Sketch Context MCP Server v${require('./package.json').version}                           │
├─────────────────────────────────────────────────────────────────┤
│  Status: Running on port ${config.port}                                   │
│  Log Level: ${config.logLevel}                                              │
│  Max File Size: ${Math.round(config.maxFileSize / 1024 / 1024)}MB                                      │
│  API Key: ${config.sketchApiKey ? '✓ Configured' : '✗ Not set'}                             │
│  Local File: ${config.localFilePath ? '✓ Configured' : '✗ Not set'}                           │
├─────────────────────────────────────────────────────────────────┤
│  Quick Links:                                                   │
│  • Server Info:   http://localhost:${config.port}                        │
│  • Health Check:  http://localhost:${config.port}/health                 │
│  • Validation:    http://localhost:${config.port}/validate               │
├─────────────────────────────────────────────────────────────────┤
│  Integration:                                                   │
│  • Cursor MCP:    http://localhost:${config.port}/sse                    │
│  • Sketch Plugin: ws://localhost:${config.port}                          │
└─────────────────────────────────────────────────────────────────┘

Setup Instructions:
1. For Cursor IDE: Add MCP server with URL http://localhost:${config.port}/sse
2. For Sketch Plugin: Connect to port ${config.port}
3. Visit http://localhost:${config.port}/validate to check your configuration

Press Ctrl+C to stop the server.
    `);
  });
  
  httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Please choose a different port.`);
    } else {
      logger.error('Server error', { error: error.message });
    }
    process.exit(1);
  });
  
} catch (error) {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
}