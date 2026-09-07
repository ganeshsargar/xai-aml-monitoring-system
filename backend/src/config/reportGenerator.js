const PDFDocument = require('pdfkit');

function generateCasePDF(caseObj, transactions, summaryGraph, stream) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  // Pipe output to the provided stream
  doc.pipe(stream);

  // Styling helper: Draw line
  const drawLine = (y) => {
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, y).lineTo(545, y).stroke();
  };

  // Header Title
  doc.rect(50, 40, 495, 60).fill('#1e3a8a');
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('AML INVESTIGATION REPORT', 70, 52);
  doc.fontSize(10).font('Helvetica').text(`Case ID: ${caseObj.case_id}  |  Generated on ${new Date().toLocaleDateString()}`, 70, 75);

  // Metadata block
  doc.fillColor('#1f2937').fontSize(12).font('Helvetica-Bold').text('CASE INFORMATION', 50, 125);
  drawLine(140);

  doc.fontSize(10).font('Helvetica-Bold').text('Title:', 50, 155);
  doc.font('Helvetica').text(caseObj.title || 'Untitled Investigation', 120, 155);

  doc.font('Helvetica-Bold').text('Status:', 50, 175);
  doc.font('Helvetica').text(caseObj.status || 'Open', 120, 175);

  doc.font('Helvetica-Bold').text('Assignee:', 300, 155);
  doc.font('Helvetica').text(caseObj.assigned_to || 'Unassigned', 380, 155);

  doc.font('Helvetica-Bold').text('Created:', 300, 175);
  doc.font('Helvetica').text(new Date(caseObj.createdAt).toLocaleString(), 380, 175);

  // Summary statistics
  doc.fillColor('#1f2937').fontSize(12).font('Helvetica-Bold').text('TRANSACTION ANALYTICS SUMMARY', 50, 215);
  drawLine(230);

  const totalAmount = transactions.reduce((acc, curr) => acc + curr.amount, 0);
  const avgRisk = transactions.length ? transactions.reduce((acc, curr) => acc + curr.risk_score, 0) / transactions.length : 0;

  doc.fontSize(10).font('Helvetica-Bold').text('Total Transactions:', 50, 245);
  doc.font('Helvetica').text(transactions.length.toString(), 160, 245);

  doc.font('Helvetica-Bold').text('Total Flow Volume:', 50, 265);
  doc.font('Helvetica').text(`INR ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 160, 265);

  doc.font('Helvetica-Bold').text('Average Risk Score:', 300, 245);
  doc.font('Helvetica').text(`${Math.round(avgRisk)}%`, 410, 245);

  doc.font('Helvetica-Bold').text('Risk Classification:', 300, 265);
  const levelText = avgRisk > 70 ? 'CRITICAL' : (avgRisk > 50 ? 'HIGH' : (avgRisk > 20 ? 'MEDIUM' : 'LOW'));
  doc.fillColor(avgRisk > 50 ? '#b91c1c' : '#1e3a8a').font('Helvetica-Bold').text(levelText, 410, 265).fillColor('#1f2937');

  // Graph analytics
  doc.fontSize(12).font('Helvetica-Bold').text('GRAPH NETWORK INSIGHTS (NETWORKX)', 50, 305);
  drawLine(320);

  if (summaryGraph) {
    doc.fontSize(10).font('Helvetica-Bold').text('Total Accounts in Network:', 50, 335);
    doc.font('Helvetica').text((summaryGraph.total_accounts || 0).toString(), 200, 335);
    
    doc.font('Helvetica-Bold').text('Detected Cycles (Wash Loops):', 50, 355);
    doc.font('Helvetica').text((summaryGraph.cycles_count || 0).toString(), 200, 355);

    doc.font('Helvetica-Bold').text('Community Group Clusters:', 300, 335);
    doc.font('Helvetica').text((summaryGraph.num_communities || 0).toString(), 450, 335);

    doc.font('Helvetica-Bold').text('Detected Fraud Rings:', 300, 355);
    doc.font('Helvetica').text((summaryGraph.fraud_rings_count || 0).toString(), 450, 355);

    // List top central accounts
    if (summaryGraph.top_central_accounts && summaryGraph.top_central_accounts.length > 0) {
      doc.fontSize(10).font('Helvetica-Bold').text('Central Network Accounts (PageRank):', 50, 385);
      let listY = 405;
      summaryGraph.top_central_accounts.forEach((acc, i) => {
        doc.fontSize(9).font('Helvetica').text(`${i+1}. ${acc.holder_name} (${acc.account_number}) - PR Score: ${acc.pagerank} - Flow: INR ${acc.total_volume.toLocaleString()}`, 65, listY);
        listY += 15;
      });
    }
  } else {
    doc.fontSize(10).font('Helvetica').text('No graph insights available for this dataset size.', 50, 335);
  }

  // Next page for transaction listings and SHAP
  doc.addPage();
  doc.rect(50, 40, 495, 30).fill('#374151');
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('TRANSACTIONS LISTING & ML INTERPRETABILITY', 65, 50);

  let txY = 90;
  transactions.slice(0, 4).forEach((tx, idx) => {
    const mappedMethod = ['Wire Transfer', 'Wire'].includes(tx.payment_method) ? 'RTGS' : (tx.payment_method === 'ACH' ? 'NEFT' : (tx.payment_method === 'Direct Deposit' ? 'IMPS' : (tx.payment_method === 'Transfer' ? 'UPI' : (tx.payment_method || 'UPI'))));
    doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`Tx ${idx + 1}: ${tx.transaction_id} | ${tx.sender_name} -> ${tx.receiver_name}`, 50, txY);
    doc.fillColor('#4b5563').font('Helvetica').text(`Amount: INR ${tx.amount.toLocaleString()} | Country: ${tx.country} | Category: ${tx.category} | Method: ${mappedMethod}`, 50, txY + 12);
    
    // Risk score indicator
    doc.fillColor(tx.risk_score > 70 ? '#b91c1c' : (tx.risk_score > 30 ? '#d97706' : '#059669'))
       .font('Helvetica-Bold')
       .text(`ML Risk Score: ${tx.risk_score}%`, 380, txY);
       
    // SHAP explanation reasons
    if (tx.reasons && tx.reasons.length > 0) {
      doc.fillColor('#4b5563').font('Helvetica-Oblique').text(`AI Reasoning: ${tx.reasons.join(', ')}`, 50, txY + 24);
    }
    
    doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(50, txY + 38).lineTo(545, txY + 38).stroke();
    txY += 48;
  });
  
  if (transactions.length > 4) {
    doc.fillColor('#6b7280').fontSize(9).font('Helvetica').text(`...and ${transactions.length - 4} more transactions.`, 50, txY + 5);
  }

  // Section: Case Notes
  const notesStart = Math.min(txY + 30, 450);
  doc.fillColor('#1f2937').fontSize(12).font('Helvetica-Bold').text('INVESTIGATION CHRONOLOGY & CASE NOTES', 50, notesStart);
  drawLine(notesStart + 10);

  let noteY = notesStart + 30;
  if (caseObj.notes && caseObj.notes.length > 0) {
    caseObj.notes.forEach(note => {
      doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(`${note.investigator} [${new Date(note.timestamp).toLocaleString()}]:`, 50, noteY);
      doc.fillColor('#374151').font('Helvetica').text(note.text, 65, noteY + 12);
      noteY += 35;
    });
  } else {
    doc.fillColor('#6b7280').fontSize(9).font('Helvetica').text('No investigator notes added yet.', 50, noteY);
  }

  // Footer / Sign-off
  const footerY = 720;
  drawLine(footerY - 10);
  doc.fillColor('#9ca3af').fontSize(8).font('Helvetica').text('CONFIDENTIAL - BANKING COMPLIANCE & AUDIT USE ONLY', 50, footerY);
  doc.text(`Page 1 of 1`, 490, footerY);

  doc.end();
}

module.exports = {
  generateCasePDF
};
