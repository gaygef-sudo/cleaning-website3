// create-checkout-session.js — One-time Stripe payment with slot guard
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');
const SHEET_TAB='Bookings',COL_DATE=7,COL_TIMESLOT=8,COL_STATUS=10;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};

function getSheetsClient(){
  const auth=new google.auth.JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  return google.sheets({version:'v4',auth});
}

async function isSlotTaken(date,timeSlot){
  try{
    const res=await getSheetsClient().spreadsheets.values.get({spreadsheetId:process.env.GOOGLE_SHEET_ID,range:`${SHEET_TAB}!A2:K`});
    return(res.data.values||[]).some(r=>(r[COL_DATE]||'').trim()===date&&(r[COL_TIMESLOT]||'').trim()===timeSlot&&(r[COL_STATUS]||'').trim().toLowerCase()==='booked');
  }catch(e){console.warn('Slot check skipped:',e.message);return false;}
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:CORS,body:''};
  if(event.httpMethod!=='POST')return{statusCode:405,headers:CORS,body:JSON.stringify({error:'Method not allowed'})};
  let body;
  try{body=JSON.parse(event.body);}catch{return{statusCode:400,headers:CORS,body:JSON.stringify({error:'Invalid JSON'})};}
  const{amount,serviceDesc,customerName,customerEmail,phone,address,notes,homeSummary,cleaningType,frequency,preferredDate,timeSlot,location,bedrooms,bathrooms,homeSize}=body;
  if(!preferredDate||!timeSlot)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'Date and time slot required'})};
  if(!amount||isNaN(amount)||Number(amount)<1)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'Invalid amount'})};
  if(await isSlotTaken(preferredDate,timeSlot))return{statusCode:200,headers:CORS,body:JSON.stringify({slotTaken:true})};
  const siteUrl=process.env.URL||'https://your-site.netlify.app';
  const metadata={customer_name:customerName||'',customer_email:customerEmail||'',phone:phone||'',address:address||'',notes:notes||'',cleaning_type:cleaningType||'',frequency:frequency||'One-Time',preferred_date:preferredDate||'',time_slot:timeSlot||'',location:location||'',home_summary:homeSummary||'',bedrooms:String(bedrooms||''),bathrooms:String(bathrooms||''),home_size:homeSize||'',service_desc:serviceDesc||''};
  try{
    const cents=Math.round(Number(amount)*100);
    const itemDesc=[homeSummary?`Home: ${homeSummary}`:null,preferredDate?`Date: ${preferredDate}`:null,timeSlot?`Time: ${timeSlot}`:null,address?`Address: ${address}`:null,phone?`Phone: ${phone}`:null,notes?`Notes: ${notes}`:null].filter(Boolean).join(' | ');
    const session=await stripe.checkout.sessions.create({payment_method_types:['card'],mode:'payment',customer_email:customerEmail||undefined,line_items:[{price_data:{currency:'usd',unit_amount:cents,product_data:{name:`Pristine Pair — ${serviceDesc||'Cleaning Service'}`,description:itemDesc||undefined}},quantity:1}],payment_intent_data:{metadata},metadata,billing_address_collection:'auto',success_url:`${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${siteUrl}/#booking`});
    return{statusCode:200,headers:CORS,body:JSON.stringify({sessionId:session.id})};
  }catch(err){
    console.error('Stripe error:',err.message);
    return{statusCode:500,headers:CORS,body:JSON.stringify({error:err.message})};
  }
};
