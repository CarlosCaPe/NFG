const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function main() {
  const buf = fs.readFileSync('clients/oncohealth/tickets/185594-review-the-doc/NewUM Data System Design.pdf');
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  fs.writeFileSync('clients/oncohealth/tickets/185594-review-the-doc/extracted-text.txt', result.text);
  console.log(`Pages: ${result.total}, Chars: ${result.text.length}`);
}

main().catch(e => console.error(e));
