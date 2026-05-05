const { google } = require('googleapis');
const COL_DATE=7,COL_TIME_SLOT=8,COL_STATUS=10,SHEET_TAB='Bookings';
const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers,body:''};
  const date=(event.queryStringParameters||{}).date;
  if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return{statusCode:400,headers,body:JSON.stringify({error:'Invalid date'})};
  try{
    const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
    const sheets=google.sheets({version:'v4',auth});
    const res=await sheets.spreadsheets.values.get({spreadsheetId:process.env.GOOGLE_SHEET_ID,range:`${SHEET_TAB}!A2:K`});
    const bookedSlots=(res.data.values||[]).filter(r=>(r[COL_DATE]||'').trim()===date&&(r[COL_STATUS]||'').trim().toLowerCase()==='booked').map(r=>(r[COL_TIME_SLOT]||'').trim()).filter(Boolean);
    return{statusCode:200,headers,body:JSON.stringify({date,bookedSlots})};
  }catch(err){
    console.error('get-availability error:',err.message);
    return{statusCode:500,headers,body:JSON.stringify({error:'Failed',bookedSlots:[]})};
  }
};
