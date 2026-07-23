const expectedNode = '22.23.1';
const currentNode = process.versions.node;

if (currentNode !== expectedNode) {
  console.error(`Expected Node.js ${expectedNode}, received ${currentNode}.`);
  process.exitCode = 1;
} else {
  console.log(`Runtime verified: Node.js ${currentNode}.`);
}
