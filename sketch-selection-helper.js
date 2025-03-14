// Selection Helper for Sketch
// Save this as a .sketchplugin file or use with Runner

var onRun = function(context) {
  var selection = context.selection;
  var doc = context.document;
  
  if (selection.count() === 0) {
    doc.showMessage("Please select at least one layer");
    return;
  }
  
  var ids = [];
  for (var i = 0; i < selection.count(); i++) {
    var layer = selection.objectAtIndex(i);
    ids.push({
      id: layer.objectID(),
      name: layer.name(),
      type: layer.className()
    });
  }
  
  // Copy to clipboard
  var pasteBoard = NSPasteboard.generalPasteboard();
  pasteBoard.clearContents();
  pasteBoard.setString_forType_(JSON.stringify(ids, null, 2), NSPasteboardTypeString);
  
  doc.showMessage("Selection IDs copied to clipboard!");
}; 