# Menu di casa

App per pianificare i pasti della settimana e generare la lista della spesa, sincronizzata tra due telefoni con Google Sheets.
Contenuto: `www/` (app), `backend/Code.gs` (Google Apps Script), `.github/workflows/android.yml` (build dell'APK).

## 1. Foglio Google e backend
1. Crea un nuovo Google Sheet. Apri **Estensioni > Apps Script**.
2. Cancella il codice esistente e incolla tutto `backend/Code.gs`. Salva.
3. Scegli la funzione **setup** e premi **Esegui**. Concedi i permessi richiesti.
4. Apri **Visualizza > Log di esecuzione** e copia il **TOKEN**. Resta segreto: non metterlo su GitHub.
5. **Distribuisci > Nuova distribuzione > Applicazione web**. Esegui come: *te stesso*. Chi ha accesso: *Chiunque*. Copia l'URL che termina con `/exec`.
6. Se modifichi `Code.gs`, usa **Distribuisci > Gestisci distribuzioni > Modifica > Nuova versione**: l'URL resta lo stesso.

Il foglio avrà le schede `Pasti`, `Menu`, `Spesa`, `Impostazioni` (create in automatico, con 7 piatti di esempio).
Il token protegge l'accesso: chi non lo conosce non può leggere né scrivere.

## 2. Caricare su GitHub (dal browser)
1. Crea un repository su github.com (privato va bene). Scompatta lo zip sul computer.
2. **Add file > Upload files** e trascina il **contenuto** della cartella (non lo zip).
3. Controlla che esista `.github/workflows/android.yml`. Se non compare (le cartelle con il punto a volte vengono saltate): **Add file > Create new file**, scrivi il nome `.github/workflows/android.yml`, incolla il contenuto del file e salva.
4. Fai commit sul ramo `main`.

## 3. Ottenere l'APK
1. Nel repository apri **Actions > Build APK**. La build parte da sola dopo il commit (oppure **Run workflow**).
2. A fine esecuzione (alcuni minuti) apri la run e scarica l'artefatto **menu-di-casa-apk**: è uno zip con `app-debug.apk`.
3. Invia l'APK ai telefoni, aprilo e consenti l'installazione da fonti sconosciute. È un APK di debug, firmato con la chiave di debug: va bene per uso personale.

## 4. Primo avvio (su ciascun telefono)
Incolla l'indirizzo `/exec` e il token, poi premi **Collega**. Restano salvati solo su quel telefono.
In alternativa all'APK puoi pubblicare la cartella `www/` con GitHub Pages e installare l'app dal browser (*Aggiungi a schermata Home*).

## 5. Come funziona
- **Genera settimana**: crea 14 pasti per la settimana mostrata. **Rigenera non bloccati**: tiene i pasti bloccati. **Cambia pasto**: sostituisce solo quello scelto.
- La lista della spesa si aggiorna con il menu della settimana modificata per ultima, tenendo le spunte e gli articoli manuali. Ingredienti con lo stesso nome compaiono una volta sola.
- Se sei offline le modifiche restano in coda e partono appena torna la rete.
- Se due telefoni cambiano lo stesso pasto insieme, vince la prima modifica arrivata e sull'altro telefono compare un avviso.
- Esclusi iniziali: latte e lattosio, legumi disattivati. Il filtro cerca le parole negli ingredienti: aggiungi tu altre voci (es. formaggi, burro) in Preferenze e controlla le etichette.

## 6. Checklist di test
- [ ] `setup` crea le 4 schede e compare il token.
- [ ] Collega: indirizzo e token corretti entrano; un token sbagliato dà errore.
- [ ] Genera settimana: 14 pasti, nessun piatto ripetuto (con almeno 14 piatti compatibili), nessuna stessa proteina a pranzo e cena.
- [ ] Con pochi piatti compare l'avviso «varietà limitata».
- [ ] Blocca un pasto, «Rigenera non bloccati»: quel pasto resta.
- [ ] Cambia pasto cambia solo quello selezionato.
- [ ] Spesa: ingredienti uniti, spunta, aggiunta manuale, filtro Da comprare / Tutti.
- [ ] Cambia un pasto: le spunte e gli articoli manuali restano.
- [ ] Spunta su un telefono: compare sull'altro entro ~20 secondi o con il pulsante di sincronizzazione.
- [ ] Modalità aereo: modifica, riattiva la rete, la modifica arriva sul foglio.
- [ ] Un piatto con «latte» negli ingredienti non viene mai scelto.
- [ ] La data «Oggi» corrisponde all'ora italiana.
