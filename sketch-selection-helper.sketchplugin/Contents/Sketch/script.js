// Sketch Context MCP
// A plugin to integrate Sketch with Cursor AI via the Model Context Protocol

// Import Sketch API modules - using Cocoa import style for compatibility
var sketch;
try {
  sketch = require('sketch/dom');
} catch (e) {
  sketch = null;
}

var sketchUI;
try {
  sketchUI = require('sketch/ui');
} catch (e) {
  sketchUI = null;
}

// Plugin state
var state = {
  selection: [],
  serverPort: 3333,
  webSocket: null,
  isConnected: false,
  ui: null
};

// Main handler - called when the plugin is run
var onRun = function(context) {
  try {
    // Create and show the UI window
    createAndShowUI(context);
    
    // Get the current selection
    updateSelectionFromContext(context);
  } catch (error) {
    log("Plugin error: " + error);
    context.document.showMessage("Plugin error: " + error);
  }
};

// Create and show UI window
function createAndShowUI(context) {
  var options = {
    identifier: 'com.sketch-context-mcp.ui',
    width: 400,
    height: 550,
    show: true,
    title: 'Sketch Context MCP',
    resizable: false,
    minimizable: true,
    fullscreenable: false,
    hideTitleBar: false,
    shouldKeepAround: true,
    handlers: {
      webView: setupWebViewHandlers
    }
  };

  var panel = createPanel(options, context);
  state.ui = panel;
}

// Create the UI panel
function createPanel(options, context) {
  // Create the panel
  var panel = NSPanel.alloc().init();
  panel.setTitle(options.title);
  panel.setIdentifier(options.identifier);
  panel.setFrame_display(NSMakeRect(0, 0, options.width, options.height), true);
  panel.setHidesOnDeactivate(false);
  panel.setBackgroundColor(NSColor.whiteColor());
  panel.setLevel(NSFloatingWindowLevel);
  panel.setFrame_display_animate(NSMakeRect(0, 0, options.width, options.height), true, true);
  panel.setRestorable(true);
  panel.makeKeyAndOrderFront(null);
  panel.standardWindowButton(NSWindowMiniaturizeButton).setHidden(!options.minimizable);
  panel.standardWindowButton(NSWindowZoomButton).setHidden(!options.resizable);
  panel.standardWindowButton(NSWindowCloseButton).setHidden(false);
  panel.standardWindowButton(NSWindowCloseButton).setAction("onCloseWindow:");
  
  // Create and configure WebView
  var config = WKWebViewConfiguration.alloc().init();
  var contentController = config.userContentController();
  
  // Create WebView with configuration
  var webView = WKWebView.alloc().initWithFrame_configuration(
    NSMakeRect(0, 0, options.width, options.height),
    config
  );
  
  // Set up communication between JavaScript and native code
  var handler = new WebViewMessageHandler();
  handler.context = context;
  handler.panel = panel;
  contentController.addScriptMessageHandler_name(handler, "sketchPlugin");
  
  // Load HTML content
  var htmlPath = context.plugin.urlForResourceNamed("UI.html");
  webView.loadFileURL_allowingReadAccessToURL(htmlPath, htmlPath);
  
  // Add WebView to the panel
  panel.contentView().addSubview(webView);
  panel.webView = webView;
  
  // Center the panel
  panel.center();
  
  return panel;
}

// WebView Message Handler (for receiving messages from JS)
function WebViewMessageHandler() {}
WebViewMessageHandler.prototype.userContentController_didReceiveScriptMessage = function(controller, message) {
  try {
    var data = JSON.parse(message.body());
    var type = data.type;
    
    switch (type) {
      case "notify":
        showNotification(data.message);
        break;
      case "copy-selection":
        copySelectionIDs();
        break;
      case "refresh-selection":
        refreshSelection(this.context);
        break;
      case "execute-command":
        executeCommand(data.id, data.command, data.params);
        break;
      case "open-url":
        openURL(data.url);
        break;
      default:
        log("Unknown message type: " + type);
    }
  } catch (error) {
    log("Error handling WebView message: " + error);
  }
};

// Setup WebView handlers
function setupWebViewHandlers(webView) {
  // Add handlers here if needed
}

// Selection Functionality

// Update selection from context
function updateSelectionFromContext(context) {
  try {
    var selection = context.selection;
    var selectionArray = [];
    
    for (var i = 0; i < selection.count(); i++) {
      try {
        var layer = selection.objectAtIndex(i);
        selectionArray.push({
          id: layer.objectID(),
          name: layer.name(),
          type: layer.className(),
          frame: {
            x: layer.frame().x(),
            y: layer.frame().y(),
            width: layer.frame().width(),
            height: layer.frame().height()
          }
        });
      } catch (layerError) {
        log("Error processing layer: " + layerError);
      }
    }
    
    state.selection = selectionArray;
    sendToWebView("selection-updated", { selection: selectionArray });
  } catch (error) {
    log("Error updating selection: " + error);
  }
}

// Refresh selection
function refreshSelection(context) {
  try {
    // Update selection from current document
    var doc = context.document || NSDocumentController.sharedDocumentController().currentDocument();
    
    if (doc) {
      var selection = doc.selectedLayers().layers();
      var selectionArray = [];
      
      for (var i = 0; i < selection.count(); i++) {
        try {
          var layer = selection.objectAtIndex(i);
          selectionArray.push({
            id: layer.objectID(),
            name: layer.name(),
            type: layer.className(),
            frame: {
              x: layer.frame().x(),
              y: layer.frame().y(),
              width: layer.frame().width(),
              height: layer.frame().height()
            }
          });
        } catch (layerError) {
          log("Error processing layer: " + layerError);
        }
      }
      
      state.selection = selectionArray;
      sendToWebView("selection-updated", { selection: selectionArray });
    }
  } catch (error) {
    log("Error refreshing selection: " + error);
  }
}

// Copy selection IDs to clipboard
function copySelectionIDs() {
  try {
    if (state.selection.length === 0) {
      showNotification("No layers selected");
      return;
    }
    
    // Format the data for clipboard
    var jsonData = JSON.stringify(state.selection, null, 2);
    
    // Copy to clipboard
    var pasteBoard = NSPasteboard.generalPasteboard();
    pasteBoard.clearContents();
    pasteBoard.setString_forType_(jsonData, NSPasteboardTypeString);
    
    // Show success message
    showNotification(state.selection.length + " layer(s) copied to clipboard!");
    
    // Log to console for debugging
    log("Selection IDs copied to clipboard:");
    log(jsonData);
  } catch (error) {
    log("Error copying to clipboard: " + error);
    showNotification("Error copying to clipboard: " + error);
  }
}

// WebSocket and MCP Functionality

// Execute commands received from WebSocket
function executeCommand(id, command, params) {
  try {
    var result;
    
    switch (command) {
      case "get_document_info":
        result = getDocumentInfo();
        break;
      case "get_selection":
        result = getSelection();
        break;
      case "create_rectangle":
        result = createRectangle(params);
        break;
      case "create_text":
        result = createText(params);
        break;
      case "set_fill_color":
        result = setFillColor(params);
        break;
      case "get_node_info":
        result = getNodeInfo(params.nodeId);
        break;
      default:
        sendToWebView("command-error", { id: id, error: "Unknown command: " + command });
        return;
    }
    
    sendToWebView("command-result", { id: id, result: result });
  } catch (error) {
    log("Error executing command: " + error);
    sendToWebView("command-error", { id: id, error: "Error executing command: " + error });
  }
}

// Command implementations

// Get document info
function getDocumentInfo() {
  try {
    if (!sketch) {
      return { error: "Sketch API not available" };
    }
    
    var document = sketch.getSelectedDocument();
    
    if (!document) {
      return { error: "No document selected" };
    }
    
    return {
      name: document.path ? document.path.split('/').pop() : 'Untitled',
      id: document.id,
      pages: document.pages.map(function(page) {
        return {
          id: page.id,
          name: page.name,
          layers: page.layers.length
        };
      }),
      currentPage: {
        id: document.selectedPage.id,
        name: document.selectedPage.name,
        layers: document.selectedPage.layers.length
      }
    };
  } catch (error) {
    log("Error getting document info: " + error);
    return { error: "Error getting document info: " + error };
  }
}

// Get current selection
function getSelection() {
  try {
    return {
      selectionCount: state.selection.length,
      selection: state.selection
    };
  } catch (error) {
    log("Error getting selection: " + error);
    return { error: "Error getting selection: " + error };
  }
}

// Get node info by ID
function getNodeInfo(nodeId) {
  try {
    if (!sketch) {
      return { error: "Sketch API not available" };
    }
    
    var document = sketch.getSelectedDocument();
    var layer = document.getLayerWithID(nodeId);
    
    if (!layer) {
      return { error: "Layer not found with ID: " + nodeId };
    }
    
    var nodeInfo = {
      id: layer.id,
      name: layer.name,
      type: layer.type,
      frame: layer.frame,
      parent: layer.parent ? { id: layer.parent.id, name: layer.parent.name, type: layer.parent.type } : null
    };
    
    // Add style information if available
    if (layer.style) {
      nodeInfo.style = {
        fills: layer.style.fills,
        borders: layer.style.borders,
        shadows: layer.style.shadows,
        opacity: layer.style.opacity
      };
    }
    
    // Add text if it's a text layer
    if (layer.type === 'Text') {
      nodeInfo.text = layer.text;
      nodeInfo.fontSize = layer.style.fontSize;
      nodeInfo.fontFamily = layer.style.fontFamily;
      nodeInfo.textAlignment = layer.style.alignment;
    }
    
    return nodeInfo;
  } catch (error) {
    log("Error getting node info: " + error);
    return { error: "Error getting node info: " + error };
  }
}

// Create a rectangle
function createRectangle(params) {
  try {
    if (!sketch) {
      return { error: "Sketch API not available" };
    }
    
    var document = sketch.getSelectedDocument();
    var page = document.selectedPage;
    
    // Create a new Rectangle shape
    var rectangle = new sketch.Rectangle({
      parent: page,
      frame: {
        x: params.x || 0,
        y: params.y || 0,
        width: params.width || 100,
        height: params.height || 100
      },
      style: {
        fills: [{
          color: params.color || '#000000',
          fillType: sketch.Style.FillType.Color
        }]
      },
      name: params.name || 'Rectangle'
    });
    
    return {
      id: rectangle.id,
      name: rectangle.name,
      type: rectangle.type,
      frame: rectangle.frame
    };
  } catch (error) {
    log("Error creating rectangle: " + error);
    return { error: "Error creating rectangle: " + error };
  }
}

// Create text
function createText(params) {
  try {
    if (!sketch) {
      return { error: "Sketch API not available" };
    }
    
    var document = sketch.getSelectedDocument();
    var page = document.selectedPage;
    
    // Create a new Text layer
    var text = new sketch.Text({
      parent: page,
      text: params.text || 'Text',
      frame: {
        x: params.x || 0,
        y: params.y || 0,
        width: params.width || 200,
        height: params.height || 50
      },
      style: {
        textColor: params.color || '#000000',
        fontSize: params.fontSize || 16,
        fontFamily: params.fontFamily || 'Helvetica',
        alignment: params.alignment || sketch.Text.Alignment.left
      },
      name: params.name || 'Text'
    });
    
    return {
      id: text.id,
      name: text.name,
      type: text.type,
      frame: text.frame,
      text: text.text
    };
  } catch (error) {
    log("Error creating text: " + error);
    return { error: "Error creating text: " + error };
  }
}

// Set fill color
function setFillColor(params) {
  try {
    if (!sketch) {
      return { error: "Sketch API not available" };
    }
    
    var document = sketch.getSelectedDocument();
    var layer = document.getLayerWithID(params.nodeId);
    
    if (!layer) {
      return { error: "Layer not found with ID: " + params.nodeId };
    }
    
    // Set the fill color
    layer.style.fills = [{
      color: params.color,
      fillType: sketch.Style.FillType.Color
    }];
    
    return {
      id: layer.id,
      name: layer.name,
      type: layer.type,
      style: {
        fills: layer.style.fills
      }
    };
  } catch (error) {
    log("Error setting fill color: " + error);
    return { error: "Error setting fill color: " + error };
  }
}

// Utility Functions

// Show notification
function showNotification(message) {
  if (sketchUI) {
    sketchUI.message(message);
  } else {
    NSApp.delegate().showMessage(message);
  }
}

// Send data to WebView
function sendToWebView(type, data) {
  if (state.ui && state.ui.webView) {
    var message = {
      type: type
    };
    
    // Copy data properties to message
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        message[key] = data[key];
      }
    }
    
    var jsonString = JSON.stringify({ pluginMessage: message });
    var script = "window.dispatchEvent(new MessageEvent('message', { data: " + jsonString + " }));";
    
    state.ui.webView.evaluateJavaScript_completionHandler(script, null);
  }
}

// Open URL
function openURL(url) {
  NSWorkspace.sharedWorkspace().openURL(NSURL.URLWithString(url));
}

// Handler for copying selection IDs
var onCopySelectionIds = function(context) {
  try {
    updateSelectionFromContext(context);
    copySelectionIDs();
  } catch (error) {
    log("Error in onCopySelectionIds: " + error);
    context.document.showMessage("Error: " + error);
  }
};
