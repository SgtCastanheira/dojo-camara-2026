function n(a){let r=[...a];for(let t=r.length-1;t>0;t--){let e=Math.floor(Math.random()*(t+1));[r[t],r[e]]=[r[e],r[t]]}return r}function o(a){return a.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9/%]+/g," ").trim()}/*dojo-embaralhar-v2*/
var __re1=/([Aa]lternativas?|[Ll]etras?|[Ii]tens?|[Oo]p\S{2,5})\s+\(?[A-E]\b/,
__re2=/(^|[.;:]\s)[A-E]\s+(est[aá]|err|é\b|descreve|exagera|extrapola)|\b[A-E]\s+é\s+(a|o|uma|um)\b|\b[A-E],\s[A-E]\b|\b[A-E]\s+e\s+[A-E]\b|\([A-E]\)|[Gg]abarito[^.]{0,30}\b[A-E]\b/,
__re3=/(todas|nenhuma|ambas|todos|nenhum)\s+(as|os|das|dos)?\s*(anteriores|acima|alternativas|afirmativas|afirma\S{3,6}|respostas|itens|op\S{2,5})|alternativas?\s+[A-E]\b|as duas (anteriores|primeiras)/i,
__mp=null;
function __hs(s){let h=5381;for(let i=0;i<s.length;i++)h=(h*33^s.charCodeAt(i))>>>0;return h.toString(36)}
function __ld(){if(__mp)return __mp;try{__mp=JSON.parse(localStorage.getItem("dojo-ultpos")||"{}")}catch{__mp={}}return __mp}
function __sv(){try{localStorage.setItem("dojo-ultpos",JSON.stringify(__mp))}catch{}}
function c(q){
if(!q||q.fx||!Array.isArray(q.o)||q.o.length<3)return q;
let e=q.e||"";
if(__re1.test(e)||__re2.test(e)||q.o.some(o=>__re3.test(o)))return q;
let n=q.o.length,m=__ld(),k=__hs((q.p||"")+"|"+q.o[q.c]),ult=m[k],pos=[];
for(let i=0;i<n;i++)if(i!==ult)pos.push(i);
let alvo=pos[Math.floor(Math.random()*pos.length)],
resto=[];for(let i=0;i<n;i++)if(i!==q.c)resto.push(i);
for(let i=resto.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[resto[i],resto[j]]=[resto[j],resto[i]]}
let o=new Array(n),J=Array.isArray(q.j)?new Array(n):null;o[alvo]=q.o[q.c];if(J)J[alvo]=q.j[q.c]||"";let t=0;
for(let i=0;i<n;i++)if(i!==alvo){o[i]=q.o[resto[t]];if(J)J[i]=q.j[resto[t]]||"";t++}
m[k]=alvo;setTimeout(__sv,0);
return Object.assign({},q,{o:o,c:alvo},J?{j:J}:{})}
function d(q,s){var e=q.e||"";if(s==null||s===q.c||!Array.isArray(q.j)||!q.j[s])return e;return "Por que a sua resposta está errada: "+q.j[s]+"\n\nPor que a correta está certa: "+e}
export{n as a,o as b,c,d};
