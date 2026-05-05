// stripe-webhook.js — Saves booking to Google Sheets + creates Calendar event
const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);
const{google}=require('googleapis');
const SHEET_TAB='Bookings';
const SLOT_HOURS={'9:00 AM':9,'12:00 PM':12,'3:00 PM':15};
const CLEAN_DUR={'Standard Cleaning':2,'Deep Cleaning':3,'Move-In / Move-Out Cleaning':3.5};

function getAuth(){
  return new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),scopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/calendar']});
}

async function appendRow(auth,meta,sessionId){
  const sheets=google.sheets({version:'v4',auth});
  const now=new Date().toLocaleString('en-US',{timeZone:'America/New_York'});
  const row=[now,meta.customer_name||'',meta.customer_email||'',meta.phone||'',meta.address||'',meta.cleaning_type||'',meta.frequency||'One-Time',meta.preferred_date||'',meta.time_slot||'',sessionId||'','Booked'];
  await sheets.spreadsheets.values.append({spreadsheetId:process.env.GOOGLE_SHEET_ID,range:`${SHEET_TAB}!A:K`,valueInputOption:'USER_ENTERED',insertDataOption:'INSERT_ROWS',resource:{values:[row]}});
  console.log('✅ Row appended:',meta.customer_name,meta.preferred_date,meta.time_slot);
}

async function createEvent(auth,meta){
  const calendar=google.calendar({version:'v3',auth});
  const calId=process.env.GOOGLE_CALENDAR_ID||'gaygef@gmail.com';
  const date=meta.preferred_date,slot=meta.time_slot,startH=SLOT_HOURS[slot];
  if(!date||startH===undefined){console.warn('Missing date/slot for calendar event');return;}
  const dur=CLEAN_DUR[meta.cleaning_type]||2.5;
  const pad=n=>String(n).padStart(2,'0');
  const endH=Math.floor(startH+dur),endM=Math.round((dur%1)*60);
  const desc=[`📞 Phone: ${meta.phone||'N/A'}`,`📧 Email: ${meta.customer_email||'N/A'}`,`🏠 Home: ${meta.home_summary||meta.address||'N/A'}`,`🧹 Service: ${meta.cleaning_type||'N/A'}`,meta.notes?`💬 Notes: ${meta.notes}`:null,``,`💳 Stripe: ${meta.session_id||'N/A'}`].filter(s=>s!==null).join('\n');
  const ev={summary:`${meta.cleaning_type||'Cleaning'} – ${meta.customer_name||'Customer'}`,location:meta.address||'',description:desc,start:{dateTime:`${date}T${pad(startH)}:00:00`,timeZone:'America/New_York'},end:{dateTime:`${date}T${pad(endH)}:${pad(endM)}:00`,timeZone:'America/New_York'},reminders:{useDefault:false,overrides:[{method:'email',minutes:1440},{method:'popup',minutes:60}]},colorId:'2'};
  const r=await calendar.events.insert({calendarId:calId,resource:ev});
  console.log('📅 Calendar event:',r.data.htmlLink);
}

exports.handler=async(event)=>{
  const sig=event.headers['stripe-signature'],secret=process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;
  try{stripeEvent=secret?stripe.webhooks.constructEvent(event.body,sig,secret):JSON.parse(event.body);}
  catch(err){console.error('Webhook sig error:',err.message);return{statusCode:400,body:`Webhook error: ${err.message}`};}
  if(stripeEvent.type==='checkout.session.completed'){
    const session=stripeEvent.data.object;
    const meta={...(session.metadata||{}),session_id:session.id};
    console.log('💳 Payment confirmed:',meta.customer_name,meta.preferred_date,meta.time_slot);
    const auth=getAuth();
    const[s,c]=await Promise.allSettled([appendRow(auth,meta,session.id),createEvent(auth,meta)]);
    if(s.status==='rejected')console.error('❌ Sheets:',s.reason?.message);
    if(c.status==='rejected')console.error('❌ Calendar:',c.reason?.message);
  }
  return{statusCode:200,body:JSON.stringify({received:true})};
};
