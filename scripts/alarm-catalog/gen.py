# -*- coding: utf-8 -*-
import re, unicodedata, json

PREFIX = {
 'ritiro':'rit','contratto':'con','documenti':'doc','pagamenti':'pag','cauzione':'cau',
 'riconsegna':'ric','danni':'dan','sinistri':'sin','lavaggi':'lav','preparazione':'prp',
 'manutenzione':'man','pneumatici':'pne','scadenze':'sca','multe':'mul','chilometraggio':'km',
 'prenotazioni':'pre','fatturazione':'fat','lead':'led','officina':'off',
}
REPARTO = {
 'ritiro':'Front Office','contratto':'Amministrazione','documenti':'Front Office',
 'pagamenti':'Amministrazione','cauzione':'Amministrazione','riconsegna':'Front Office',
 'danni':'Officina','sinistri':'Amministrazione','lavaggi':'Lavaggio','preparazione':'Lavaggio',
 'manutenzione':'Officina','pneumatici':'Officina','scadenze':'Amministrazione',
 'multe':'Amministrazione','chilometraggio':'Amministrazione','prenotazioni':'Front Office',
 'fatturazione':'Amministrazione','lead':'Commerciale','officina':'Officina',
}

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode()
    s = s.lower().replace("'", ' ')
    s = re.sub(r'[^a-z0-9]+','_', s).strip('_')
    return re.sub(r'_+','_', s)

STOP = {'di','da','del','della','dei','delle','il','lo','la','le','un','una','al','alla','per','con','in','e','a','ma','che','non_ancora'}
def make_id(pref, label):
    words = [w for w in slug(label).split('_') if w]
    keep=[]
    for w in words:
        if w in STOP and len(keep)>0: continue
        keep.append(w)
        if len('_'.join(keep))>38: break
    return pref+'_'+'_'.join(keep)

def priority(label):
    if label.isupper() or 'GRAVEMENTE' in label: return 'bloccante'
    l = label.lower()
    # "non ..." = qualcosa che doveva essere fatto e non lo e': mai informativo.
    if any(k in l for k in ['scaduto','scaduta','superato','grave','non pagat','fallit','rifiutat','illeggibile','sotto il limite','danneggiato','non compatibile','insufficiente','ferma','fermo','anomal','doppia','sovrapposizione','raggiunto']): return 'urgente'
    if any(k in l for k in ['in scadenza','mancante','mancanti','non effettuat','non completat','non inviat','non registrat','non inserit','non assegnat','non generat','da controllare','vicino','quasi','in ritardo','da verificare','incomplet','non verificat','non arrivat','oltre','attende','compromette','aperta','aperto','da restituire','da sbloccare','da incassare','non riconsegnat','non aggiornato','non idonei','non presa','senza risposta','non risolto','non ricevut','non pront','sporco','bassa','basso']): return 'attenzione'
    if re.search(r'\bnon\b', l) or 'mancant' in l or 'senza ' in l: return 'attenzione'
    return 'informativo'

def threshold(label):
    l = label.lower()
    if 'non ancora arrivato' in l: return 15, 'minutes_after'
    if 'in ritardo' in l and not re.search(r'\d', l): return 15, 'minutes_after'
    if 'non iniziato entro' in l: return 5, 'minutes_after'
    if 'termine' in l and ('raggiunto' in l or 'superato' in l): return 0, 'days'
    if any(k in l for k in ['da restituire','da sbloccare','da trattenere','storno','restituita ma non','pratica cauzione']): return 1, 'days'
    m = re.search(r'in ritardo di (\d+) minut', l)
    if m: return int(m.group(1)), 'minutes_after'
    m = re.search(r'(?:tra|a) (\d+) minut', l)
    if m: return int(m.group(1)), 'minutes_before'
    m = re.search(r'tra (\d+) ore', l)
    if m: return int(m.group(1))*60, 'minutes_before'
    if 'raggiunto' in l or 'raggiunta' in l: return 0, 'minutes_after'
    if 'in scadenza' in l or 'vicina' in l or 'prossim' in l: return 7, 'days'
    if 'da x giorni' in l: return 3, 'days'
    if 'da x minuti' in l: return 30, 'minutes_after'
    if 'quasi esaurit' in l: return 100, 'km'
    return None, None

# Quando l'etichetta non contiene un tempo, l'anticipo di default dipende dal
# gruppo: una pratica incompleta si segnala PRIMA del ritiro, una scadenza
# veicolo giorni prima. Tutti modificabili dal gestionale.
GROUP_DEFAULT = {
 'ritiro': (120,'minutes_before'), 'contratto': (120,'minutes_before'),
 'documenti': (120,'minutes_before'), 'pagamenti': (120,'minutes_before'),
 'cauzione': (120,'minutes_before'), 'prenotazioni': (120,'minutes_before'),
 'riconsegna': (60,'minutes_before'), 'lavaggi': (60,'minutes_before'),
 'preparazione': (60,'minutes_before'), 'lead': (60,'minutes_after'),
 'danni': (1,'days'), 'sinistri': (1,'days'), 'multe': (1,'days'),
 'chilometraggio': (1,'days'), 'fatturazione': (1,'days'), 'officina': (1,'days'),
 'manutenzione': (7,'days'), 'pneumatici': (7,'days'), 'scadenze': (7,'days'),
}

groups=[]; entries=[]; seen=set()
for raw in open('catalogo.txt', encoding='utf-8'):
    line = raw.rstrip('\n')
    if not line.strip(): continue
    parts = line.split('|')
    if len(parts)==3:
        num,title,key = parts
        groups.append({'key':key,'num':int(num),'title':title})
        continue
    key = groups[-1]['key']; pref = PREFIX[key]
    aid = make_id(pref, line)
    n=2
    base=aid
    while aid in seen: aid=f'{base}_{n}'; n+=1
    seen.add(aid)
    tv,tu = threshold(line)
    if tv is None: tv,tu = GROUP_DEFAULT[key]
    entries.append({'id':aid,'group':key,'label':line,'priority':priority(line),
                    'threshold_value':tv,'threshold_unit':tu,'reparto':REPARTO[key]})

json.dump({'groups':groups,'entries':entries}, open('catalogo.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(groups),'gruppi,',len(entries),'allarmi')
from collections import Counter
print('priorita:', dict(Counter(e['priority'] for e in entries)))
print('unita:', dict(Counter(e['threshold_unit'] for e in entries)))
print()
for e in entries[:8]: print(f"  {e['id']:<44} {e['priority']:<11} {e['threshold_value']} {e['threshold_unit']}")
