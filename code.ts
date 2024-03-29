// // This shows the HTML page in "ui.html".
// figma.showUI(__html__);

// // Grap selection
// const selection = figma.currentPage.selection["0"].characters;
// console.log(figma.currentPage.selection["0"].characters);

// // Send data to plugin UI
// figma.ui.postMessage({"selection": selection });

// // Calls to "parent.postMessage" from within the HTML page will trigger this
// // callback. The callback will be passed the "pluginMessage" property of the
// // posted message.
// figma.ui.onmessage = msg => {
//   // One way of distinguishing between different types of messages sent from
//   // your HTML page is to use an object with a "type" property like this.
//   if (msg.type === 'create-rectangles') {
//     const nodes: SceneNode[] = [];
//     for (let i = 0; i < msg.count; i++) {
//       const rect = figma.createRectangle();
//       rect.x = i * 150;
//       rect.fills = [{type: 'SOLID', color: {r: 1, g: 0.5, b: 0}}];
//       figma.currentPage.appendChild(rect);
//       nodes.push(rect);
//     }
//     figma.currentPage.selection = nodes;
//     figma.viewport.scrollAndZoomIntoView(nodes);
//   }

//   // Make sure to close the plugin when you're done. Otherwise the plugin will
//   // keep running, which shows the cancel button at the bottom of the screen.
//   figma.closePlugin();
// };


// MAIN PLUGIN CODE

async function main(): Promise<string | undefined> {
  // Roboto Regular is the font that objects will be created with by default in
  // Figma. We need to wait for fonts to load before creating text using them.
  await figma.loadFontAsync({ family: "Inter", style: "Regular" })

  // get selection
  const node = figma.currentPage.selection[0]
  
  // Make sure the selection is a single piece of text before proceeding.
  if (figma.currentPage.selection.length !== 1) {
    return "Select a single node."
  }
  
  if (node.type !== 'TEXT') {
    return "Select a single text node."
  }

  // get text of selection
  const text = node.characters

  // set variables
  let gap = 1
  let space = 3
  let countX = 0
  const min = -2
  const max = 2

  // Create a new text node for each character, and
  // measure the total width.
  const nodes = []
  let width = 0
  for (let i = 0; i < text.length; i++) {
    try {
      // load font from selection  
      await figma.loadFontAsync(node.getRangeFontName(i, i + 1) as FontName);
    } catch (error) {
      console.error(error);
    }
  
    const letterNode = figma.createText();
    // letterNode.fontSize = node.fontSize;
    try {
      letterNode.fontSize = node.fontSize;
    } catch (error) {
      console.error(error);
    }
    try {
      letterNode.fontName = node.fontName;
    } catch (error) {
      console.error(error);
    }
  
    letterNode.characters = text.charAt(i);
    width += letterNode.width;
    
    // check if its a space character and change the width
    if (letterNode.width == 0) {
      letterNode.resize(space, letterNode.height);
    }
  
    // add gap between letters
    if (i !== 0) {
      width += gap;
    }
  
    // push letters in nodes
    if (node.parent) {
      (node.parent as BaseNode & ChildrenMixin).appendChild(letterNode);
      nodes.push(letterNode);
    }
  }
  
  

  // Walk through each letter and position it on a circle of radius r.
  nodes.forEach(function (letterNode) {

    // position Character
    letterNode.x = node.x + countX
    letterNode.y = node.y
    
    // rotate Character random
    //letterNode.rotation = Math.floor(Math.random() * (max - min + 1)) + min
    letterNode.rotation = Math.random() * (max - min + 1) + min


    // count X position up
    countX = countX + letterNode.width
  })

  // Put all nodes in a group
  if (node.parent) {
    const nodesGroup: GroupNode = figma.group(nodes, node.parent as BaseNode & ChildrenMixin);
    nodesGroup.name = node.characters;
    // Select and focus the group
    figma.currentPage.selection = [nodesGroup];
    figma.viewport.scrollAndZoomIntoView([nodesGroup]);
  }
  // delete original selection
  node.remove();
}

main().then((message: string | undefined) => {
  figma.closePlugin(message)
})