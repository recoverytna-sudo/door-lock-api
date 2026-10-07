const { google } = require('googleapis');
const { Readable } = require('stream');

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Google Authentication
    const auth = new google.auth.JWT(
      process.env.CLIENT_EMAIL,
      null,
      process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : '',
      [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // ==========================================
    // 🌟 GET REQUEST (getOffices & Dashboard Search)
    // ==========================================
    if (req.method === 'GET') {
      const { action, date } = req.query;

      // 1. Sheet2 မှ Office & Position List ယူခြင်း
      const officeRes = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'Sheet2!A1:B1000'
      });

      const rows = officeRes.data.values || [];
      const officeList = [];
      const positionList = [];
      for (let r = 0; r < rows.length; r++) {
        if (rows[r][0] && rows[r][0].trim() !== "") officeList.push(rows[r][0].trim());
        if (rows[r][1] && rows[r][1].trim() !== "") positionList.push(rows[r][1].trim());
      }

      if (action === 'getOffices') {
        return res.status(200).json({ offices: officeList, positions: positionList });
      }

      // 2. Dashboard Date Search
      const sheet1Res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'Sheet1!A:F'
      });

      const allRows = sheet1Res.data.values || [];
      const result = [];

      for (let i = 1; i < allRows.length; i++) {
        const rowDate = String(allRows[i][0] || "").trim().replace(/'/g, '');
        if (rowDate === date?.trim()) {
          result.push({
            date: rowDate,
            name: allRows[i][1] || "",
            id: allRows[i][2] || "",
            position: allRows[i][3] || "",
            office: allRows[i][4] || "",
            images: allRows[i][5] ? allRows[i][5].split(", ") : []
          });
        }
      }

      return res.status(200).json({ uploaded: result, masterOffices: officeList });
    }

    // ==========================================
    // 🌟 POST REQUEST (Duplicate Check, Upload & Save)
    // ==========================================
    if (req.method === 'POST') {
      const { date, name, id, position, office, images } = req.body;

      // 1. Duplicate စစ်ဆေးခြင်း
      const sheet1Res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: 'Sheet1!A:E'
      });

      const allRows = sheet1Res.data.values || [];
      const startIndex = Math.max(1, allRows.length - 100);
      let duplicateFound = false;
      let duplicateInfo = null;

      for (let i = startIndex; i < allRows.length; i++) {
        const rowDate = String(allRows[i][0] || "").trim().replace(/'/g, '');
        const rowName = allRows[i][1];
        const rowPosition = allRows[i][3];
        const rowOffice = allRows[i][4];

        if (rowDate === date && rowPosition === position && rowOffice === office) {
          duplicateFound = true;
          duplicateInfo = { name: rowName, position: rowPosition, office: rowOffice, date: rowDate };
          break;
        }
      }

      if (duplicateFound) {
        const errMsg = `❌ ${duplicateInfo.position} က ${duplicateInfo.name} ကနေပြီးတော့ ${duplicateInfo.office} အတွက်ကို ${duplicateInfo.date} အတွက် တင်ပြီးသွားပါပြီ။`;
        return res.status(200).json({ status: "duplicate", message: errMsg });
      }

      // 2. Drive သို့ ပုံများ Upload တင်ခြင်း
      const imageUrls = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const buffer = Buffer.from(img.base64, 'base64');
        const stream = Readable.from(buffer);

        const fileMetaData = {
          name: `${office}_${date}_${i}`,
          parents: [process.env.FOLDER_ID]
        };

        const media = {
          mimeType: img.type,
          body: stream
        };

        const file = await drive.files.create({
          resource: fileMetaData,
          media: media,
          fields: 'id, webContentLink'
        });

        imageUrls.push(file.data.webContentLink || `https://drive.google.com/uc?id=${file.data.id}`);
      }

      // 3. Sheet1 ထဲသို့ Row ရေးသွင်းခြင်း
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [["'" + date, name, id, position, office, imageUrls.join(", ")]]
        }
      });

      return res.status(200).json({ status: 'success' });
    }
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
