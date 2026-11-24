// Personal-name data (personal names N2): our own lists for the 33 real-world name bases, the seed
// names of the ten invented ones, and the famous names no household carries. Written for the names
// prototype (MIT, as the module): no list is copied from a source, so there is no vendor folder or
// licence row. Each part keeps its own notes below.

// Personal-name data for the 33 real-world name bases, keyed by the place-name base's name.
//
// Written for the names prototype (MIT, as the module), from general knowledge of each tradition's
// historical names; no list is copied from a source. Names of famous rulers and characters are
// left out, so a household never carries one (harness: FAMOUS). Lists run from the most common name down, so
// a pick weighted by rank gives the bunching of real naming (many Johns, few Ebles).
//
// Each base:
// - m, f: given names, most common first.
// - family: inherited family names, most common first (bases that use them).
// - features: descriptive bynames, in the culture's language (m, and f where the form changes).
// - trades: occupational bynames by trade concept (see TRADE_CONCEPT), in the culture's language.
// - place: how a toponymic byname is formed from a place name ("{p}" the place).
// - father: how a patronymic is formed from the father's given name (see NameConventions.js).
// - form, order, wife, familyFor: the base's default convention (see NameConventions.js).
// - familyFrom: "list" where family names are a closed set (no bynames are coined).
// - method: the base's own default method, where the namer's would not suit it (Roman praenomina
//   were a closed set of about twenty).

export const REAL_BASES = {
    German: {
        form: "inherited", wife: "takes",
        m: "Heinrich,Konrad,Johann,Hans,Friedrich,Otto,Ulrich,Hermann,Dietrich,Berthold,Walther,Albrecht,Rudolf,Ludwig,Nikolaus,Peter,Jakob,Eberhard,Gerhard,Bernhard,Werner,Burkhard,Hartmann,Arnold,Gottfried,Kuno,Lienhard,Matthias,Georg,Wolfgang,Lorenz,Martin,Ruprecht,Siegfried,Engelbert,Leopold,Michael,Thomas,Wilhelm,Volkmar",
        f: "Margarethe,Katharina,Elisabeth,Anna,Agnes,Gertrud,Adelheid,Mechthild,Hedwig,Kunigunde,Sophia,Barbara,Ursula,Elsbeth,Irmgard,Gisela,Hildegard,Jutta,Dorothea,Christina,Magdalena,Clara,Ottilia,Walburga,Beatrix,Richardis,Liutgard,Petronella,Brigitta,Gutta",
        family: "Schmidt,Müller,Schneider,Fischer,Weber,Meyer,Wagner,Becker,Schulz,Hoffmann,Koch,Bauer,Richter,Klein,Wolf,Schröder,Neumann,Schwarz,Zimmermann,Braun,Krüger,Hartmann,Lange,Werner,Krause,Lehmann,Köhler,Herrmann,König,Walter,Huber,Kaiser,Fuchs,Lang,Vogel,Keller,Berger,Roth,Beck,Baumann,Engel,Vogt,Brandt,Haas,Ziegler,Kuhn,Stein,Busch",
        features: { m: "Klein,Lang,Kurz,Schwarz,Weiß,Braun,Roth,Jung,Alt,Krause,Fromm,Kühn,Groß,Fuchs,Wolf,Hahn,Vogel,Stark" },
        trades: { smith: "Schmidt", miller: "Müller", baker: "Becker", weaver: "Weber", tailor: "Schneider", shoemaker: "Schuster", carpenter: "Zimmermann", mason: "Steinmetz", butcher: "Metzger", brewer: "Breuer", carter: "Fuhrmann", tanner: "Gerber", dyer: "Färber", fuller: "Walker", priest: "Pfaff", clerk: "Schreiber", fisher: "Fischer", shepherd: "Schäfer", thatcher: "Decker", merchant: "Kaufmann", gardener: "Gärtner", bowyer: "Bogner", innkeeper: "Wirt", cook: "Koch", mariner: "Schiffer", goldsmith: "Goldschmidt", cutler: "Messerschmidt", tiler: "Ziegler", saddler: "Sattler", watchman: "Wächter", bailiff: "Vogt", farmer: "Bauer", porter: "Träger", physician: "Arzt" },
        place: "{p}er",
    },
    English: {
        form: "inherited", wife: "takes",
        m: "John,William,Thomas,Richard,Robert,Henry,Walter,Roger,Hugh,Nicholas,Geoffrey,Simon,Adam,Ralph,Stephen,Peter,Gilbert,Philip,Alan,Reginald,Edmund,Laurence,Hamo,Osbert,Ranulf,Baldwin,Edward,Martin,Jordan,Matthew,Andrew,Bartholomew,Gervase,Humphrey,Miles,Nigel,Odo,Piers,Warin,Elias",
        f: "Alice,Joan,Agnes,Margaret,Matilda,Isabel,Emma,Cecily,Juliana,Christina,Avice,Beatrice,Edith,Elena,Sybil,Mabel,Amice,Margery,Alison,Rose,Katherine,Eleanor,Lettice,Felicia,Petronilla,Idonea,Constance,Hawise,Muriel,Denise",
        family: "Smith,Taylor,Baker,Walker,Wright,Turner,Cooper,Carter,Fletcher,Clarke,Thatcher,Mason,Webb,Fuller,Archer,Hayward,Shepherd,Fisher,Brewer,Butcher,Green,Wood,Hill,Brook,Atwood,Bridge,Ford,Hall,Moor,Field,Lane,Marsh,Brown,White,Black,Young,Little,Long,Short,Strong,Read,Johnson,Williamson,Robinson,Wilkins,Dickson,Harris,Hobbs,Perkins,Watkins",
        features: { m: "Brown,White,Black,Grey,Read,Young,Little,Long,Short,Strong,Wise,Good,Proud,Bold,Fox,Hawk,Swift,Fairchild,Armstrong,Whitehead" },
        trades: { smith: "Smith", miller: "Miller", baker: "Baker", weaver: "Webb", tailor: "Taylor", shoemaker: "Souter", carpenter: "Wright", mason: "Mason", butcher: "Butcher", brewer: "Brewer", carter: "Carter", tanner: "Tanner", dyer: "Dyer", fuller: "Fuller", priest: "Priest", clerk: "Clarke", fisher: "Fisher", shepherd: "Shepherd", thatcher: "Thatcher", merchant: "Chapman", gardener: "Gardener", bowyer: "Bowyer", fletcher: "Fletcher", glover: "Glover", innkeeper: "Taverner", cook: "Cook", cooper: "Cooper", mariner: "Seaman", goldsmith: "Goldsmith", cutler: "Cutler", tiler: "Tyler", saddler: "Sadler", watchman: "Ward", bailiff: "Reeve", farmer: "Husband", porter: "Porter", physician: "Leech", turner: "Turner", archer: "Archer" },
        place: "{p}",
        father: { m: "{f}son", f: "{f}son" },
    },
    French: {
        form: "inherited", wife: "takes",
        m: "Jean,Guillaume,Pierre,Jacques,Robert,Thomas,Nicolas,Raoul,Hugues,Gautier,Renaud,Étienne,Simon,Girard,Bernard,Arnaud,Gilles,Philippe,Martin,Michel,Olivier,Thibaut,Enguerrand,Geoffroi,Baudouin,Aimery,Bertrand,Godefroi,Lambert,Mathieu,Denis,Colin,Perrin,Huon,Eudes,Raymond,Louis,Henri,Yves,Foulques",
        f: "Jeanne,Marie,Marguerite,Agnès,Isabeau,Perrette,Alix,Catherine,Guillemette,Jacqueline,Béatrice,Blanche,Éléonore,Mahaut,Aude,Ermengarde,Hélène,Héloïse,Isabelle,Juliane,Laurette,Mathilde,Nicole,Pernelle,Sibylle,Yolande,Adèle,Clémence,Denise,Colette",
        family: "Martin,Bernard,Dubois,Thomas,Robert,Richard,Petit,Durand,Leroy,Moreau,Simon,Laurent,Lefebvre,Michel,Garnier,David,Bertrand,Roux,Vincent,Fournier,Morel,Girard,André,Mercier,Dupont,Lambert,Bonnet,François,Martinez,Legrand,Boucher,Chevalier,Faure,Blanc,Rousseau,Gauthier,Perrin,Clément,Dumont,Fontaine,Lemoine,Masson,Charpentier,Meunier,Boulanger,Tisserand",
        features: { m: "Petit,Legrand,Leblanc,Lenoir,Leroux,Lebrun,Lejeune,Levieux,Lebon,Lefort,Ledoux,Lesage,Gros,Roux,Blanc,Brun,Fort,Doux" },
        trades: { smith: "Lefebvre", miller: "Meunier", baker: "Boulanger", weaver: "Tisserand", tailor: "Couturier", shoemaker: "Cordonnier", carpenter: "Charpentier", mason: "Masson", butcher: "Boucher", brewer: "Brasseur", carter: "Charretier", tanner: "Tanneur", dyer: "Teinturier", fuller: "Foulon", priest: "Leprêtre", clerk: "Leclerc", fisher: "Pêcheur", shepherd: "Berger", thatcher: "Couvreur", merchant: "Marchand", gardener: "Jardinier", bowyer: "Larcher", innkeeper: "Hôtelier", cook: "Queux", cooper: "Tonnelier", mariner: "Marinier", goldsmith: "Orfèvre", tiler: "Tuilier", saddler: "Sellier", watchman: "Leguet", bailiff: "Bailly", farmer: "Laboureur", porter: "Portier", physician: "Mire", archer: "Larcher" },
        place: "de {p}",
    },
    Italian: {
        form: "inherited", wife: "keeps",
        m: "Giovanni,Pietro,Francesco,Antonio,Bartolomeo,Jacopo,Niccolò,Andrea,Lorenzo,Guido,Matteo,Simone,Filippo,Marco,Paolo,Tommaso,Domenico,Luca,Benedetto,Bernardo,Cristoforo,Giacomo,Ugolino,Lapo,Cione,Dino,Neri,Vanni,Bonaccorso,Guglielmo,Rinaldo,Ruggero,Gherardo,Federico,Alessandro,Cosimo,Taddeo,Stefano,Michele,Leonardo",
        f: "Caterina,Margherita,Giovanna,Maria,Lucia,Agnese,Francesca,Bartolomea,Antonia,Lisa,Bice,Monna,Tessa,Nanna,Piera,Chiara,Beatrice,Costanza,Isabella,Lucrezia,Ginevra,Simona,Elena,Bianca,Fiora,Angela,Andreina,Benedetta,Cecilia,Diana",
        family: "Rossi,Russo,Ferrari,Esposito,Bianchi,Romano,Colombo,Ricci,Marino,Greco,Bruno,Gallo,Conti,De Luca,Costa,Giordano,Mancini,Rizzo,Lombardi,Moretti,Barbieri,Fontana,Santoro,Mariani,Rinaldi,Caruso,Ferrara,Galli,Martini,Leone,Longo,Gentile,Martinelli,Vitale,Serra,Coppola,Fabbri,Bernardi,Sartori,Pellegrini",
        features: { m: "Rossi,Bianchi,Neri,Bruno,Biondi,Grassi,Piccoli,Grossi,Lunghi,Ricci,Gentile,Allegri,Mancini,Calvi,Barbieri" },
        trades: { smith: "Ferrari", miller: "Molinari", baker: "Fornaro", weaver: "Tessitore", tailor: "Sartori", shoemaker: "Calzolari", carpenter: "Falegname", mason: "Muratori", butcher: "Beccari", carter: "Carrettieri", tanner: "Conciatori", dyer: "Tintori", fuller: "Gualchierai", priest: "Preti", clerk: "Notari", fisher: "Pescatori", shepherd: "Pastori", merchant: "Mercanti", gardener: "Ortolani", innkeeper: "Albergatori", cook: "Cuochi", cooper: "Bottai", mariner: "Marinari", goldsmith: "Orefici", saddler: "Sellai", bailiff: "Podestà", farmer: "Contadini", porter: "Portinari", physician: "Medici", barber: "Barbieri" },
        place: "da {p}",
        father: { m: "di {f}", f: "di {f}" },
    },
    Castillian: {
        form: "patronymic", wife: "keeps",
        m: "Juan,Pedro,Diego,Rodrigo,Fernando,Alfonso,Gonzalo,García,Martín,Sancho,Gómez,Pelayo,Álvaro,Lope,Nuño,Gutierre,Ruy,Fernán,Íñigo,Alonso,Domingo,Esteban,Andrés,Miguel,Bermudo,Ordoño,Tello,Vela,Blasco,Lorenzo",
        f: "María,Juana,Catalina,Isabel,Teresa,Urraca,Sancha,Elvira,Leonor,Mencía,Inés,Constanza,Beatriz,Aldonza,Berenguela,Mayor,Toda,Jimena,Estefanía,Marina,Francisca,Ana,Violante,Blanca,Guiomar",
        family: "García,Fernández,González,Rodríguez,López,Martínez,Sánchez,Pérez,Gómez,Díaz,Álvarez,Muñoz,Ruiz,Hernández,Jiménez,Moreno,Romero,Navarro,Torres,Domínguez,Vázquez,Ramos,Gil,Serrano,Blanco,Molina,Castro,Ortega,Delgado,Herrera,Peña,Vega,Prieto,Calvo,Rubio,Lozano,Cano,Caballero,Herrero,Pastor",
        features: { m: "Blanco,Moreno,Rubio,Delgado,Calvo,Bravo,Leal,Rico,Cano,Prieto,Royo,Gordo,Crespo,Lozano" },
        trades: { smith: "Herrero", miller: "Molinero", baker: "Hornero", weaver: "Tejedor", tailor: "Sastre", shoemaker: "Zapatero", carpenter: "Carpintero", mason: "Cantero", butcher: "Carnicero", carter: "Carretero", tanner: "Curtidor", dyer: "Tintorero", priest: "Clérigo", clerk: "Escribano", fisher: "Pescador", shepherd: "Pastor", merchant: "Mercader", gardener: "Hortelano", innkeeper: "Mesonero", cook: "Cocinero", cooper: "Tonelero", mariner: "Marinero", goldsmith: "Platero", saddler: "Sillero", bailiff: "Alcalde", farmer: "Labrador", porter: "Portero", physician: "Físico", knight: "Caballero" },
        place: "de {p}",
        father: { rule: "castilian" },
    },
    Ruthenian: {
        form: "patronymic", wife: "keeps",
        m: "Ivan,Vasiliy,Fyodor,Andrei,Mikhail,Dmitriy,Pyotr,Semyon,Grigoriy,Yuriy,Konstantin,Boris,Gleb,Vladimir,Yaroslav,Mstislav,Svyatoslav,Vsevolod,Roman,Oleg,Igor,Danila,Nikita,Stepan,Timofei,Afanasiy,Matvei,Kuzma,Luka,Ilya,Yakov,Prokhor,Savva,Foma,Zakhar,Kirill",
        f: "Maria,Anna,Yevdokiya,Olga,Yelena,Feodosiya,Agafya,Marfa,Anastasiya,Pelageya,Praskovya,Akulina,Fedora,Ksenia,Tatiana,Yefrosiniya,Ulyana,Varvara,Vasilisa,Darya,Irina,Lyubava,Malusha,Predslava,Rogneda,Yaroslava,Zlata,Militsa,Dobrava,Agrafena",
        family: "Ivanov,Smirnov,Kuznetsov,Popov,Vasiliev,Petrov,Sokolov,Mikhailov,Novikov,Fyodorov,Morozov,Volkov,Alekseev,Lebedev,Semyonov,Yegorov,Pavlov,Kozlov,Stepanov,Nikolaev,Orlov,Andreev,Makarov,Zakharov,Zaitsev,Solovyov,Borisov,Romanov,Medvedev,Melnikov",
        features: { m: "Bely,Cherny,Ryzhy,Maly,Velikiy,Kosoi,Khromoi,Tolstoi,Bolshoi,Lysy,Seryi,Sedoi", f: "Belaya,Chernaya,Ryzhaya,Malaya,Velikaya,Kosaya,Khromaya,Tolstaya,Bolshaya,Lysaya,Seraya,Sedaya" },
        trades: { smith: "Kuznets", miller: "Melnik", baker: "Pekar", weaver: "Tkach", tailor: "Portnoi", shoemaker: "Sapozhnik", carpenter: "Plotnik", mason: "Kamenshchik", butcher: "Myasnik", carter: "Izvozchik", tanner: "Kozhevnik", dyer: "Krasilshchik", priest: "Pop", clerk: "Dyak", fisher: "Rybak", shepherd: "Pastukh", merchant: "Kupets", gardener: "Sadovnik", innkeeper: "Korchmar", cook: "Povar", cooper: "Bondar", goldsmith: "Zolotar", saddler: "Sedelnik", watchman: "Storozh", potter: "Gonchar", farmer: "Krestyanin" },
        place: "{p}sky",
        father: { rule: "slavic" },
    },
    Nordic: {
        form: "patronymic", wife: "keeps",
        m: "Olav,Harald,Sigurd,Eirik,Thorstein,Bjørn,Gunnar,Halvard,Ivar,Knut,Ragnar,Sven,Thorkel,Ulf,Arne,Asbjørn,Einar,Erling,Finn,Gaut,Grim,Hakon,Hallvard,Ketil,Kolbein,Leif,Magnus,Ottar,Rolf,Sigmund,Steinar,Thord,Torgeir,Vidar,Orm,Arnfinn,Brand,Eystein,Helge,Inge",
        f: "Ingrid,Gudrun,Ragnhild,Sigrid,Astrid,Gunnhild,Thora,Helga,Ingeborg,Kristin,Margret,Ragna,Signy,Solveig,Thorunn,Aslaug,Bergljot,Dagny,Gyda,Halldora,Ingunn,Jorunn,Liv,Ragnfrid,Ranveig,Sigrun,Thordis,Ulvhild,Vigdis,Åsa",
        family: "Hansen,Johansen,Olsen,Larsen,Andersen,Nilsen,Pedersen,Kristiansen,Jensen,Karlsen,Berg,Haugen,Hagen,Dahl,Lund,Strand,Bakke,Moen,Nygaard,Solberg,Lie,Holm,Lien,Aas,Vik,Rønning,Myhre,Brekke,Eide,Sæther",
        features: { m: "hin Gamle,hin Unge,hin Sterke,hin Hvite,hin Svarte,hin Rauðe,hin Digre,hin Mildi,hin Spake,Langbein,Skjegge,Haarfagre,Kveldulf,Hardrade" },
        trades: { smith: "Smed", miller: "Møller", baker: "Baker", weaver: "Vever", tailor: "Skredder", shoemaker: "Skomaker", carpenter: "Snekker", fisher: "Fisker", shepherd: "Hyrde", merchant: "Kjøpmann", priest: "Prest", mariner: "Skipper" },
        place: "{p}",
        father: { m: "{f}sson", f: "{f}sdatter", rule: "nordic" },
    },
    Greek: {
        form: "byname", wife: "takes",
        m: "Ioannes,Georgios,Konstantinos,Nikolaos,Theodoros,Michael,Demetrios,Basileios,Leon,Nikephoros,Alexios,Andronikos,Manuel,Isaakios,Romanos,Stephanos,Petros,Athanasios,Gregorios,Christophoros,Eustathios,Kosmas,Damianos,Sergios,Niketas,Theophilos,Symeon,Ioseph,Markos,Loukas",
        f: "Maria,Anna,Eirene,Theodora,Zoe,Eudokia,Helene,Sophia,Aikaterine,Theophano,Euphrosyne,Kale,Thekla,Agathe,Anastasia,Barbara,Euphemia,Kyranna,Martha,Xene,Pulcheria,Olympias,Phokas,Stephanis,Thomais",
        family: "Komnenos,Doukas,Angelos,Palaiologos,Laskaris,Kantakouzenos,Phokas,Skleros,Argyros,Batatzes,Branas,Bryennios,Dalassenos,Kamateros,Kontostephanos,Melissenos,Synadenos,Tornikes,Tzimiskes,Botaneiates",
        features: { m: "Mauros,Leukos,Mikros,Megas,Kalos,Pyrros,Xanthos,Kouros,Gerontas,Strabos", f: "Maura,Leuke,Mikra,Megale,Kale,Pyrra,Xanthe" },
        trades: { smith: "Chalkeus", miller: "Mylonas", baker: "Artopoios", weaver: "Hyphantes", tailor: "Raptes", shoemaker: "Tzangares", carpenter: "Tekton", mason: "Lithoxoos", butcher: "Makellarios", priest: "Papas", clerk: "Notarios", fisher: "Psaras", shepherd: "Poimen", merchant: "Pragmateutes", gardener: "Kepouros", mariner: "Nautes", goldsmith: "Chrysochoos", physician: "Iatros", potter: "Kerameus" },
        place: "{p}ites",
        father: { m: "{f}poulos", f: "{f}poulina" },
    },
    Roman: {
        form: "roman", wife: "keeps", method: "list",
        m: "Gaius,Lucius,Marcus,Publius,Quintus,Titus,Gnaeus,Aulus,Decimus,Sextus,Servius,Spurius,Tiberius,Manius,Appius,Numerius,Vibius,Postumus,Kaeso,Mamercus",
        f: "Prima,Secunda,Tertia,Quarta,Quinta,Maior,Minor,Paulla,Tertulla,Polla",
        family: "Julius,Cornelius,Claudius,Valerius,Aemilius,Fabius,Antonius,Flavius,Junius,Licinius,Pompeius,Sempronius,Sulpicius,Tullius,Aurelius,Calpurnius,Caecilius,Domitius,Livius,Marius,Octavius,Porcius,Servilius,Terentius,Ulpius,Vipsanius,Plautius,Furius,Hortensius,Fulvius",
        features: { m: "Rufus,Longus,Varus,Niger,Albus,Crassus,Paullus,Magnus,Celer,Severus,Felix,Pius,Lentulus,Naso,Strabo,Brutus,Cicero,Agricola,Pulcher,Sabinus", f: "Rufa,Longa,Vara,Nigra,Alba,Crassa,Paulla,Magna,Celeris,Severa,Felix,Pia,Lentula,Pulchra,Sabina" },
        trades: { smith: "Faber", miller: "Pistor", carpenter: "Faber", shepherd: "Pastor", merchant: "Mercator", fisher: "Piscator", farmer: "Agricola", potter: "Figulus", physician: "Medicus", mariner: "Nauta", clerk: "Scriba" },
        place: "{p}nus",
    },
    Finnic: {
        form: "byname", wife: "takes",
        m: "Matti,Juho,Antti,Heikki,Lauri,Olli,Pekka,Martti,Mikko,Tuomas,Jaakko,Yrjö,Erkki,Pentti,Paavo,Simo,Sipi,Niilo,Lassi,Tapani,Klemetti,Esko,Arvid,Henrik,Ilmari,Kalevi,Tuure,Ukko,Väinö,Ahti",
        f: "Maria,Anna,Kaarina,Liisa,Valpuri,Margareta,Brita,Kirsti,Agneta,Elina,Riitta,Helena,Kerttu,Saara,Marketta,Ainikki,Aino,Kyllikki,Lempi,Tellervo,Vellamo,Marjatta,Sofia,Malin,Katri",
        family: "Korhonen,Virtanen,Mäkinen,Nieminen,Mäkelä,Hämäläinen,Laine,Heikkinen,Koskinen,Järvinen,Lehtonen,Lehtinen,Saarinen,Salminen,Heinonen,Niemi,Heikkilä,Kinnunen,Salonen,Turunen,Salo,Laitinen,Tuominen,Rantanen,Karjalainen,Jokinen,Mattila,Savolainen,Lahtinen,Ahonen",
        features: { m: "Pitkä,Musta,Valkoinen,Punainen,Pieni,Iso,Vanha,Nuori,Kova,Viisas" },
        trades: { smith: "Seppä", miller: "Mylläri", weaver: "Kutoja", tailor: "Räätäli", shoemaker: "Suutari", carpenter: "Puuseppä", fisher: "Kalastaja", shepherd: "Paimen", merchant: "Kauppias", priest: "Pappi", farmer: "Talonpoika" },
        place: "{p}nen",
        father: { m: "{f}npoika", f: "{f}ntytär" },
    },
    Korean: {
        form: "inherited", order: "family-first", wife: "keeps", familyFrom: "list",
        m: "Seong-gye,Bang-won,Jeong-do,Mong-ju,Sun-sin,Hwang,Yeong-sil,Jae-hyeon,Gyeong-hwan,Mun-su,Dong-hyeon,Sang-cheol,Jin-u,Hyeon-jun,Jae-won,Seung-ho,Tae-ho,Yong-su,Gwang-su,Myeong-ho,Hak-gyu,Chang-ho,Ui-jeong,Gi-cheol,Jun-seok",
        f: "Sin-saimdang,Hwang-jini,Seol-wha,Bo-hui,Myeong-seon,Seon-hwa,Su-jeong,Hye-ryeong,Ok-ja,Sun-ja,Yeong-ja,Jeong-suk,Mi-ok,Bong-sun,Gap-sun,Geum-hwa,Eun-jeong,Ae-ryeon,Yeon-hwa,Wol-hwa",
        family: "Kim,Lee,Park,Choi,Jeong,Kang,Jo,Yun,Jang,Lim,Han,O,Seo,Sin,Gwon,Hwang,An,Song,Yu,Hong,Jeon,Go,Mun,Yang,Son,Bae,Baek,Heo,Nam,Sim",
        features: {},
        trades: {},
        place: "{p}",
    },
    Chinese: {
        form: "inherited", order: "family-first", wife: "keeps", familyFrom: "list",
        m: "Wei,Ming,Hong,Jian,Guo,Zhi,Wen,Qiang,Lin,Bo,Tao,Jun,Hui,Long,Feng,Yi,Hao,Xiang,Cheng,Jie,Kang,Yong,Shan,Bin,Zhen,An,Ping,Rong,Sheng,Yuan",
        f: "Mei,Lan,Hua,Ying,Fang,Jing,Li,Xiu,Yan,Hui,Juan,Lian,Zhen,Qing,Yun,Ping,Xia,Hong,Yu,Jiao,Shu,Wan,Ning,Rui,Xue",
        family: "Wang,Li,Zhang,Liu,Chen,Yang,Huang,Zhao,Wu,Zhou,Xu,Sun,Ma,Zhu,Hu,Guo,He,Gao,Lin,Luo,Zheng,Liang,Xie,Song,Tang,Han,Feng,Deng,Cao,Peng",
        features: {},
        trades: {},
        place: "{p}",
    },
    Japanese: {
        form: "inherited", order: "family-first", wife: "keeps", familyFor: "wealth",
        m: "Taro,Jiro,Saburo,Shiro,Goro,Hachiro,Yoshitsune,Yoritomo,Nobunaga,Hideyoshi,Ieyasu,Masashige,Takauji,Kiyomori,Shingen,Kenshin,Munenori,Kagekatsu,Nagamasa,Tadakatsu,Kanbei,Hanzo,Kojiro,Sosuke,Heihachi,Kansuke,Matabei,Genzaemon,Kyubei,Yasuhide",
        f: "Hana,Yuki,Chiyo,Tomoe,Shizuka,Kiku,Matsu,Ume,Take,Tsuru,Kame,Haru,Natsu,Aki,Sen,Ine,Kane,Tama,Masa,Ichi,Nene,Koto,Fuji,Toku,Mitsu,Yae,Sayo,Kiyo,Rin,Fusa",
        family: "Tanaka,Suzuki,Takahashi,Watanabe,Ito,Yamamoto,Nakamura,Kobayashi,Kato,Yoshida,Yamada,Sasaki,Yamaguchi,Matsumoto,Inoue,Kimura,Hayashi,Shimizu,Mori,Ikeda,Hashimoto,Ishikawa,Ogawa,Okada,Maeda,Fujita,Goto,Murakami,Takeda,Uesugi",
        features: {},
        trades: {},
        place: "{p}",
    },
    Portuguese: {
        form: "patronymic", wife: "keeps",
        m: "João,Pedro,Afonso,Fernão,Gonçalo,Martim,Vasco,Álvaro,Diogo,Rodrigo,Lourenço,Estêvão,Nuno,Duarte,Gil,Mem,Paio,Soeiro,Egas,Garcia,Lopo,Rui,Sancho,Vicente,Domingos,Bartolomeu,Francisco,Henrique,Manuel,Tristão",
        f: "Maria,Inês,Beatriz,Leonor,Catarina,Isabel,Teresa,Constança,Mafalda,Urraca,Sancha,Brites,Filipa,Guiomar,Joana,Margarida,Violante,Aldonça,Mécia,Briolanja,Branca,Elvira,Mor,Dórdia,Genebra",
        family: "Silva,Santos,Ferreira,Pereira,Oliveira,Costa,Rodrigues,Martins,Sousa,Fernandes,Gonçalves,Gomes,Lopes,Marques,Alves,Almeida,Ribeiro,Pinto,Carvalho,Teixeira,Moreira,Correia,Mendes,Nunes,Soares,Vieira,Monteiro,Cardoso,Rocha,Barros",
        features: { m: "Branco,Moreno,Ruivo,Pequeno,Grande,Velho,Moço,Bravo,Leal,Rico" },
        trades: { smith: "Ferreira", miller: "Moleiro", baker: "Forneiro", weaver: "Tecelão", tailor: "Alfaiate", shoemaker: "Sapateiro", carpenter: "Carpinteiro", mason: "Pedreiro", butcher: "Carniceiro", carter: "Carreteiro", priest: "Clérigo", clerk: "Escrivão", fisher: "Pescador", shepherd: "Pastor", merchant: "Mercador", gardener: "Hortelão", mariner: "Marinheiro", goldsmith: "Ourives", farmer: "Lavrador", physician: "Físico" },
        place: "de {p}",
        father: { rule: "castilian" },
    },
    Nahuatl: {
        form: "single", wife: "keeps",
        m: "Cuauhtli,Ocelotl,Tochtli,Itzcoatl,Mazatl,Coatl,Ehecatl,Tlaloc,Chimalli,Mixcoatl,Tenoch,Tototl,Cipactli,Yaotl,Teuctli,Tecuani,Quiahuitl,Atl,Acatl,Tecpatl,Calli,Cuetzpalin,Ozomatli,Ollin,Tlacotl,Itztli,Mazatzin,Tochtzin,Coyotl,Ocotl,Tepetl,Cuauhcoatl",
        f: "Xochitl,Citlali,Itzel,Meztli,Ameyalli,Atzi,Cihuatl,Eztli,Izel,Malinalli,Nenetl,Necahual,Papalotl,Quetzalxochitl,Tlalli,Xiuhcoatl,Yaretzi,Zyanya,Miahuaxihuitl,Ayauhtli,Atotoztli,Tozcuetzin,Chalchiuhnenetzin,Xiuhtzin,Tlazohtzin,Quiauhxochitl,Macuilxochitl,Coacueye,Huitzilxochitl,Cozcaxochitl,Matlalxochitl",
        family: "",
        features: { m: "Tlatoani,Huehue,Tepiton,Hueyi,Tliltic,Iztac,Chichiltic" },
        trades: {},
        place: "{p}catl",
    },
    Hungarian: {
        form: "inherited", order: "family-first", wife: "takes",
        m: "János,István,László,Miklós,Péter,György,Mihály,Pál,András,Ferenc,Benedek,Balázs,Lőrinc,Tamás,Gergely,Imre,Béla,Géza,Kálmán,Mátyás,Ambrus,Demeter,Domokos,Fülöp,Gáspár,Jakab,Márton,Simon,Bálint,Zsigmond",
        f: "Erzsébet,Katalin,Anna,Margit,Ilona,Borbála,Dorottya,Zsófia,Ágnes,Klára,Magdolna,Orsolya,Judit,Krisztina,Veronika,Apollónia,Fruzsina,Jolán,Kunigunda,Piroska,Sára,Ilka,Zsuzsanna,Gizella,Helena",
        family: "Nagy,Kovács,Tóth,Szabó,Horváth,Varga,Kiss,Molnár,Németh,Farkas,Balogh,Papp,Takács,Juhász,Lakatos,Mészáros,Oláh,Simon,Rácz,Fekete,Szilágyi,Török,Fehér,Balázs,Gál,Kis,Szűcs,Kocsis,Orsós,Pintér",
        features: { m: "Nagy,Kis,Fekete,Fehér,Vörös,Barna,Szép,Hosszú,Ősz,Kopasz,Bátor,Vak" },
        trades: { smith: "Kovács", miller: "Molnár", baker: "Pék", weaver: "Takács", tailor: "Szabó", shoemaker: "Varga", carpenter: "Ács", mason: "Kőműves", butcher: "Mészáros", carter: "Kocsis", tanner: "Tímár", dyer: "Festő", priest: "Papp", clerk: "Deák", fisher: "Halász", shepherd: "Juhász", merchant: "Kalmár", gardener: "Kertész", innkeeper: "Csapláros", cook: "Szakács", cooper: "Bodnár", goldsmith: "Ötvös", saddler: "Nyerges", farmer: "Földes", potter: "Fazekas", furrier: "Szűcs", bowyer: "Íjgyártó", tiler: "Cserepes" },
        place: "{p}i",
    },
    Turkish: {
        form: "byname", wife: "keeps", featureFirst: true,
        m: "Ahmed,Mustafa,Ali,Hasan,Hüseyin,İbrahim,Osman,Orhan,Murad,Süleyman,Selim,Yusuf,Ömer,Abdullah,Halil,İsmail,Musa,İsa,Davud,Kasım,Mahmud,Hamza,Turgut,Tuğrul,Alp,Kılıç,Yakub",
        f: "Fatma,Ayşe,Hatice,Emine,Zeynep,Hafsa,Gülbahar,Nilüfer,Rabia,Saliha,Şah,Meryem,Kerime,Esma,Safiye,Hanzade,Gevherhan,Raziye,Ümmügülsüm,Hümaşah,Ayşegül,Gülfem,Halime",
        family: "",
        features: { m: "Kara,Ak,Uzun,Kısa,Deli,Topal,Sarı,Kızıl,Genç,Koca,Küçük,Büyük,Kör,Çelebi" },
        trades: { smith: "Demirci", miller: "Değirmenci", baker: "Ekmekçi", weaver: "Dokumacı", tailor: "Terzi", shoemaker: "Kunduracı", carpenter: "Marangoz", mason: "Taşçı", butcher: "Kasap", carter: "Arabacı", tanner: "Debbağ", dyer: "Boyacı", priest: "İmam", clerk: "Katip", fisher: "Balıkçı", shepherd: "Çoban", merchant: "Tüccar", gardener: "Bahçıvan", bowyer: "Okçu", innkeeper: "Hancı", cook: "Aşçı", goldsmith: "Kuyumcu", mariner: "Gemici", porter: "Hammal", watchman: "Bekçi", potter: "Çömlekçi", saddler: "Saraç", physician: "Hekim", farmer: "Rençber" },
        place: "{p}lı",
        father: { m: "{f}oğlu", f: "{f} kızı" },
    },
    Amazigh: {
        form: "patronymic", wife: "keeps",
        m: "Yuba,Aksil,Tariq,Yusuf,Idir,Amayas,Mazigh,Gaya,Firmus,Ziri,Buluggin,Hammad,Yahya,Abdelmumin,Amastan,Aghilas,Arezki,Lounis,Mokrane,Salem,Uthman,Ziyad,Menad,Tafat,Usaden,Ameziane",
        f: "Fadma,Tasadit,Tiziri,Thilelli,Tafsut,Lalla,Zaynab,Fatma,Tamazight,Tanina,Dassine,Tilelli,Tadla,Tinzar,Itri,Lunja,Taziri,Tafukt,Yamina,Ouardia,Dahbia,Tamenzut,Nedjma",
        family: "",
        features: { m: "Amellal,Aberkan,Azegzaw,Amezyan,Ameqqran,Awessar" },
        trades: {},
        place: "At {p}",
        father: { m: "ag {f}", f: "welet {f}" },
    },
    Arabic: {
        form: "patronymic", wife: "keeps",
        m: "Muhammad,Ahmad,Ali,Hasan,Husayn,Umar,Uthman,Abd Allah,Ibrahim,Yusuf,Ismail,Khalid,Said,Hamza,Jafar,Musa,Isa,Yahya,Sulayman,Harun,Abbas,Zayd,Tariq,Salah,Nur,Mahmud,Mustafa,Qasim,Walid,Hisham",
        f: "Fatima,Aisha,Khadija,Zaynab,Maryam,Ruqayya,Umm Kulthum,Asma,Hafsa,Safiyya,Sumayya,Layla,Rabia,Sukayna,Zubayda,Amina,Halima,Nafisa,Salma,Shajar,Hind,Jamila,Lubna,Maymuna,Nusayba",
        family: "",
        features: { m: "al-Kabir,al-Saghir,al-Aswad,al-Abyad,al-Tawil,al-Qasir,al-Ahmar,al-Hakim,al-Rashid,al-Mansur" },
        trades: { smith: "al-Haddad", miller: "al-Tahhan", baker: "al-Khabbaz", weaver: "al-Hayik", tailor: "al-Khayyat", shoemaker: "al-Iskafi", carpenter: "al-Najjar", mason: "al-Bannaʾ", butcher: "al-Jazzar", carter: "al-Jammal", tanner: "al-Dabbagh", dyer: "al-Sabbagh", priest: "al-Imam", clerk: "al-Katib", fisher: "al-Sammak", shepherd: "al-Rai", merchant: "al-Tajir", gardener: "al-Bustani", innkeeper: "al-Khanji", cook: "al-Tabbakh", goldsmith: "al-Sayigh", mariner: "al-Bahri", porter: "al-Hammal", physician: "al-Tabib", potter: "al-Fakhkhar", perfumer: "al-Attar", farmer: "al-Fallah" },
        place: "al-{p}i",
        father: { m: "ibn {f}", f: "bint {f}" },
    },
    Inuit: {
        form: "single", wife: "keeps",
        m: "Aputsiaq,Inuk,Kunuk,Nanuq,Qillaq,Sakku,Tulugaq,Ulloriaq,Amaruq,Anori,Arnaq,Iluq,Kallik,Miki,Nukilik,Pita,Qajaq,Siku,Taqqiq,Uqsuruq,Aklak,Kanaaq,Nattiq,Paninnguaq,Qisuk,Pavia",
        f: "Aaju,Ajaaq,Arnaq,Ivalu,Kiviuq,Naja,Nivi,Panik,Pilunnguaq,Qaaviq,Sila,Suluk,Tuuli,Uki,Aviaq,Ataataq,Ikiaq,Ilaaq,Nuka,Pipaluk,Saqqaq,Tukkuttok,Usuk,Nauja,Kirima,Paneeraq,Ukaleq",
        family: "",
        features: {},
        trades: {},
        place: "{p}miut",
    },
    Basque: {
        form: "inherited", wife: "keeps",
        m: "Eneko,Antso,Gartzia,Otsoa,Beltza,Aznar,Txanton,Peru,Joanes,Martin,Domingo,Lope,Sancho,Iñigo,Fortun,Belasko,Gaztelu,Jaun,Mikel,Xabier,Ander,Unai,Ibai,Gorka,Kepa,Koldo,Txomin,Paskual,Erramun,Andoni",
        f: "Andere,Toda,Urraka,Oneka,Santxa,Gaxi,Graziana,Maria,Katalin,Elixabete,Itziar,Ainhoa,Arantza,Begoña,Miren,Nekane,Edurne,Izaskun,Gentzane,Amaia,Maddi,Garazi,Uxue,Leire,Josune",
        family: "Etxeberria,Goikoetxea,Zubiri,Agirre,Arana,Elizondo,Iturbe,Mendizabal,Urrutia,Larrañaga,Zabala,Garmendia,Aranburu,Goñi,Ibarra,Lizarraga,Olano,Txurruka,Uriarte,Zubizarreta,Arrieta,Bengoetxea,Etxegarai,Ugarte,Elorza",
        features: { m: "Beltza,Zuria,Gorria,Txiki,Handia,Zaharra,Gaztea" },
        trades: { smith: "Arotz", miller: "Errotari", shepherd: "Artzain", fisher: "Arrantzale" },
        place: "{p}ko",
    },
    Nigerian: {
        form: "patronymic", wife: "keeps",
        m: "Adebayo,Babatunde,Oluwaseun,Adewale,Olumide,Ayodele,Kayode,Femi,Segun,Tunde,Emeka,Chinedu,Obinna,Ikenna,Nnamdi,Chukwudi,Ugochukwu,Musa,Abubakar,Ibrahim,Usman,Sani,Danjuma,Bello,Oranmiyan,Oduduwa,Sango,Ajaka,Eweka,Ozolua",
        f: "Adebisi,Folasade,Funmilayo,Ngozi,Chiamaka,Adaeze,Nneka,Amaka,Ifeoma,Chioma,Aisha,Zainab,Hauwa,Amina,Halima,Moremi,Iyalode,Abeni,Ayoka,Bisola,Ebunoluwa,Kemi,Morenike,Titilayo,Yewande",
        family: "",
        features: {},
        trades: { smith: "Alagbede", hunter: "Ode", drummer: "Ayan" },
        place: "{p}",
        father: { m: "{f}", f: "{f}" },
    },
    Celtic: {
        form: "clan", wife: "keeps",
        m: "Domnall,Conall,Áed,Niall,Brian,Donnchad,Diarmait,Cormac,Eógan,Fergus,Fiachra,Lorcán,Ruaidrí,Tadg,Cathal,Colmán,Ciarán,Dúnlang,Flann,Máel Sechnaill,Murchad,Ragnall,Muirchertach,Cellach,Senán,Bran,Cadoc,Rhodri,Owain,Gruffudd",
        f: "Gormlaith,Órlaith,Derbforgaill,Mór,Sadb,Eithne,Fionnuala,Gráinne,Áine,Bébinn,Caitríona,Dubchoblaig,Ethniu,Lassar,Máire,Mairenn,Muirenn,Nuala,Róisín,Síle,Siobhán,Una,Gwenllian,Angharad,Nest",
        family: "Domnaill,Néill,Briain,Cerbaill,Ruairc,Conchobair,Ceallaigh,Súilleabháin,Cathail,Dubhda,Flaithbheartaigh,Mathghamhna,Murchadha,Raghallaigh,Seachnasaigh,Duibhir,Cennétig,Fhlainn,Gormáin,Eochadha",
        features: { m: "Mór,Bec,Dub,Ruad,Bán,Glas,Donn,Odhar,Dall,Cáech" },
        trades: { smith: "Gobhann", carpenter: "tSaoir", priest: "Sagairt", clerk: "Chléirigh", shepherd: "Aoire", bard: "Bhaird" },
        place: "{p}",
        clan: { m: ["Ó {c}", "Mac {c}"], f: ["Ní {c}", "Nic {c}"] },
    },
    Mesopotamian: {
        form: "single", wife: "keeps",
        m: "Awil-Ili,Ibni-Marduk,Ilum-bani,Warad-Sin,Apil-Sin,Sin-iddinam,Nur-Shamash,Ili-iddinam,Ahum,Belanum,Iddin-Ea,Mar-Ishtar,Nabu-nasir,Sin-leqi-unninni,Ishme-Dagan,Rim-Sin,Zimri-Lim,Ibbi-Sin,Puzur-Ashur,Marduk-zakir,Adad-nirari,Ilushuma,Erishum,Iddin-Nabu,Bel-ibni,Nabu-apla-iddina",
        f: "Amat-Shamash,Bitti-Dagan,Ahassunu,Lamassatum,Huzalatum,Kubaba,Shibtu,Naqia,Iltani,Belessunu,Amat-Mamu,Ishtar-ummi,Beltani,Erishti-Aya,Geme-Enlil,Ninshatapada,Tabni-Ishtar,Ahat-abisha,Lamassi,Ummi-waqrat,Inib-sharri,Shiptu,Kunshimatum",
        family: "",
        features: {},
        trades: {},
        place: "{p}ayu",
        father: { m: "mār {f}", f: "mārat {f}" },
    },
    Iranian: {
        form: "byname", wife: "keeps",
        m: "Bahram,Hormozd,Kavad,Peroz,Rostam,Sohrab,Kaveh,Farhad,Bijan,Mehrdad,Babak,Mazdak,Narseh,Parviz,Fereydun,Jamshid,Esfandiyar,Garshasp,Siyavash,Omar,Abbas,Ismail",
        f: "Shirin,Roudabeh,Tahmineh,Manijeh,Gordafarid,Faranak,Pantea,Azarmidokht,Purandokht,Mandana,Atossa,Parysatis,Roxana,Banu,Golnar,Parvaneh,Soraya,Mahin,Nasrin,Laleh,Setareh,Shahrbanu,Farangis,Katayoun,Homay",
        family: "",
        features: { m: "Bozorg,Kuchak,Siah,Sepid,Sorkh,Dana,Delavar" },
        trades: { smith: "Ahangar", miller: "Asiaban", baker: "Nanva", weaver: "Bafandeh", tailor: "Khayyat", carpenter: "Najjar", butcher: "Ghassab", dyer: "Rangraz", fisher: "Mahigir", shepherd: "Chupan", merchant: "Bazargan", gardener: "Baghban", goldsmith: "Zargar", physician: "Pezeshk", farmer: "Barzegar" },
        place: "{p}i",
        father: { m: "{f}zadeh", f: "{f}zadeh" },
    },
    Hawaiian: {
        form: "single", wife: "keeps",
        m: "Keoua,Keawe,Umi,Liloa,Hakau,Lono,Kana,Kaiana,Kalanimoku,Keoni,Makoa,Kekoa,Kaimana,Akoni,Palani,Kale,Kamaka,Ikaika,Kawika,Peni,Kekumu,Keola,Kalei,Kanoa,Koa,Mana,Nohea,Pono,Kainoa",
        f: "Kinau,Kekauluohi,Kalama,Kalola,Namahana,Keakealani,Leilani,Kalani,Malia,Noelani,Kailani,Moana,Nalani,Pualani,Kealoha,Mahina,Iolana,Lokelani,Hokulani,Makana,Aolani,Oliwa,Healani,Nani,Pua,Malie,Keala,Kiele,Mele",
        family: "",
        features: {},
        trades: {},
        place: "{p}",
    },
    Karnataka: {
        form: "byname", wife: "keeps",
        m: "Madara,Harihara,Bukka,Ballala,Narasimha,Someshwara,Vikramaditya,Ranna,Pampa,Ponna,Janna,Kumara,Raghavanka,Nagavarma,Sripati,Lingaraja,Mallikarjuna,Siddharama,Nanjunda,Basappa,Siddappa,Mallappa,Ramanna,Kempanna,Lingappa,Honnappa,Chennappa,Veerappa,Narayana,Chiranjiv",
        f: "Shantala,Chennamma,Abbakka,Obavva,Mallamma,Gangambike,Neelambike,Lakkamma,Honnamma,Kalavva,Sankavva,Rudramma,Attimabbe,Kanti,Muktayakka,Satyakka,Lingamma,Somavva,Guddavva,Lakshmi,Geetha,Gowramma,Siddamma,Basamma,Kempamma,Puttamma,Ningamma,Shivamma,Maithri",
        family: "",
        features: {},
        trades: {},
        place: "{p}",
        father: { m: "{f}", f: "{f}" },
    },
    Quechua: {
        form: "single", wife: "keeps",
        m: "Manqu,Tupaq,Sinchi Ruqa,Yawar Waqaq,Wiraqucha,Lluqi Yupanki,Mayta Qhapaq,Qhapaq Yupanki,Inka Ruqa,Kusi,Rumi,Inti,Amaru,Kuntur,Puma,Waman,Illapa,Sayri,Titu,Kispi,Paullu,Huwan,Husiy,Atuq,Yawri,Kunturi,Sinchi,Apu,Yachay,Quri,Mallku",
        f: "Chimpu Uqllu,Kusi Quyllur,Quyllur,Killa,Sisa,Tika,Nina,Paqarina,Urpi,Wayta,Chaska,Suyay,Ayllu,Inkill,Kantu,Mayu,Pacha,Qhispi,Rawa,Sumaq,Tamya,Wayra,Yupanki,Illari,Phuyu,Sami,Yaku,Kusikuyllur,Chuqi,Inkillay",
        family: "",
        features: { m: "Yupanki,Qhapaq,Ruqa,Uqllu" },
        trades: {},
        place: "{p}",
    },
    Swahili: {
        form: "patronymic", wife: "keeps",
        m: "Ali,Hamisi,Juma,Bakari,Rashidi,Salim,Omari,Abdalla,Hassani,Mwinyi,Shaabani,Ramadhani,Musa,Athumani,Faraji,Jabari,Kassim,Majid,Mbaraka,Nassoro,Said,Tumaini,Zuberi,Baraka,Hamadi",
        f: "Fatuma,Mwanaisha,Zawadi,Amina,Halima,Mwajuma,Rehema,Saida,Subira,Tatu,Mwanahawa,Asha,Zuhura,Mwanaidi,Riziki,Imani,Neema,Pendo,Upendo,Furaha,Mariamu,Khadija,Mwanamisi,Mwantumu,Siti",
        family: "",
        features: {},
        trades: {},
        place: "{p}",
        father: { m: "bin {f}", f: "binti {f}" },
    },
    Vietnamese: {
        form: "inherited", order: "family-first", wife: "keeps", familyFrom: "list",
        m: "Văn Lang,Đức,Quang,Thái,Tuấn,Minh,Hùng,Dũng,Cường,Hải,Sơn,Long,Phúc,Bảo,Thành,Trung,Nghĩa,Khải,Tông,Lợi,Trãi,Hưng,Quyền,Bộ Lĩnh,Huệ",
        f: "Lan,Mai,Hoa,Hương,Thu,Hà,Ngọc,Hằng,Linh,Phương,Trinh,Nhi,Yến,Thảo,Diệp,Nga,Xuân,Hạnh,Loan,Cúc,Trắc,Nhị,Triệu,Chiêu,Huyền",
        family: "Nguyễn,Trần,Lê,Phạm,Hoàng,Phan,Vũ,Đặng,Bùi,Đỗ,Hồ,Ngô,Dương,Lý,Đinh,Đào,Trịnh,Mạc,Lương,Tô",
        features: {},
        trades: {},
        place: "{p}",
    },
    Cantonese: {
        form: "inherited", order: "family-first", wife: "keeps", familyFrom: "list",
        m: "Wai,Ming,Hung,Kin,Kwok,Chi,Man,Keung,Lam,Po,To,Chun,Fai,Lung,Fung,Yee,Ho,Cheung,Shing,Kit,Hong,Wing,Shan,Ban,Yan",
        f: "Mei,Lan,Wa,Ying,Fong,Ching,Lai,Sau,Yin,Wai,Kuen,Lin,Chan,Hing,Wan,Ping,Ha,Hung,Yu,Kiu,Shu,Yuen,Ning,Sum,Suet",
        family: "Chan,Wong,Lee,Cheung,Lau,Ng,Lam,Ho,Leung,Chow,Tsang,Lai,Yip,Fung,Tse,Kwok,Ma,Mak,Tam,Cheng,Yau,Tang,Hui,Lo,Siu",
        features: {},
        trades: {},
        place: "{p}",
    },
    Mongolian: {
        form: "clan", wife: "keeps",
        m: "Berke,Subutai,Jebe,Muqali,Bo'orchu,Jelme,Qasar,Belgutei,Toghrul,Jamukha,Yesügei,Bayan,Arigh,Kaidu,Toqta,Ghazan,Nogai,Chormaqan,Tolun,Altan,Esen,Enkhbat,Ganbold,Erdene,Tömör,Sükh,Baatar,Ganzorig,Batu-Erdene",
        f: "Oghul Qaimish,Chabi,Alaqai,Checheyigen,Qojin,Tümelün,Yisui,Yisugen,Qulan,Ibaqa,Doquz,Bulughan,Kököchin,Sartaq,Bayarmaa,Battsetseg,Sarangerel,Altantsetseg,Oyun,Tsetseg,Naran,Saran,Khongorzul,Gerel,Odval,Solongo,Altangerel",
        family: "Borjigin,Kiyat,Jalayir,Tayichiud,Merkit,Kereit,Naiman,Olkhunut,Khongirad,Baarin,Uriankhai,Oirat,Jadaran,Besud,Barlas,Manghud,Arulad,Suldus,Ikires,Uru'ud",
        features: { m: "Khan,Noyan,Bahadur,Sechen,Mergen" },
        trades: {},
        place: "{p}",
        clan: { m: ["{c}"], f: ["{c}"] },
    },
    Levantine: {
        form: "patronymic", wife: "keeps",
        m: "Yosef,Avraham,Yitzhak,Yaakov,Moshe,Aharon,David,Shlomo,Shmuel,Eliyahu,Daniel,Natan,Yehuda,Binyamin,Shimon,Levi,Reuven,Menahem,Hiram,Ahiram,Abibaal,Eshmunazar,Tabnit,Bodashtart,Yehawmilk,Elissar,Mattan,Hanno,Hamilcar,Adherbal",
        f: "Sarah,Rivka,Rahel,Leah,Miriam,Devorah,Hannah,Esther,Rut,Yael,Tamar,Batsheva,Avigail,Elisheva,Naomi,Shulamit,Yehudit,Tziporah,Dinah,Michal,Elissa,Sophonisba,Batbaal,Amotmilk,Arishat",
        family: "",
        features: { m: "ha-Gadol,ha-Katan,ha-Zaken" },
        trades: { smith: "Nappah", weaver: "Oreg", tailor: "Hayyat", carpenter: "Nagar", mason: "Banai", butcher: "Tabbah", tanner: "Bursi", dyer: "Tzabba", priest: "Kohen", clerk: "Sofer", fisher: "Dayyag", shepherd: "Roeh", merchant: "Sohar", physician: "Rofe", potter: "Yotzer", goldsmith: "Tzoref" },
        place: "{p}i",
        father: { m: "ben {f}", f: "bat {f}" },
    },
};

/**
 * The concept a P-towns trade gives an occupational byname, where it has one. Trades with no entry
 * (labourers, widows, the trades of size most of the time) take no occupational byname.
 */
export const TRADE_CONCEPT = {
    smith: "smith", goldsmith: "goldsmith", armourer: "smith", cutler: "cutler", miller: "miller", "miller's man": "miller",
    baker: "baker", weaver: "weaver", tailor: "tailor", shoemaker: "shoemaker", carpenter: "carpenter", mason: "mason",
    stonecutter: "mason", butcher: "butcher", brewer: "brewer", carter: "carter", drover: "carter", tanner: "tanner",
    dyer: "dyer", fuller: "fuller", priest: "priest", cleric: "priest", clerk: "clerk", scrivener: "clerk", notary: "clerk",
    fisher: "fisher", fishmonger: "fisher", shepherd: "shepherd", thatcher: "thatcher", tiler: "tiler", merchant: "merchant",
    mercer: "merchant", chapman: "merchant", cornmonger: "merchant", gardener: "gardener", bowyer: "bowyer", fletcher: "fletcher",
    glover: "glover", innkeeper: "innkeeper", mariner: "mariner", shipwright: "carpenter", porter: "porter", saddler: "saddler",
    watchman: "watchman", warden: "watchman", bailiff: "bailiff", husbandman: "farmer", cottar: "farmer", physician: "physician",
    "barber-surgeon": "barber", apothecary: "physician", herbalist: "physician",
};

// Personal-name data for the module's ten invented name bases (Human Generic and the fantasy
// bases), keyed by the place-name base's name. Written for the names prototype (MIT, as the module); the seed names
// are invented here, not taken from any game or book.
//
// These peoples have no real names to draw on, so given names are generated by default: a chain
// trained on the seed names below (one per sex) and, for a share of names, a stem cut from the
// culture's own place names with one of its endings, so a people's names sound like its places.
//
// Each base:
// - m, f: seed names that train each sex's chain (and are used as they are now and then).
// - endings: { m, f } endings joined to a place-name stem.
// - stem: the share of given names made from a place-name stem.
// - family: where the family, house or clan name comes from: "place" (the culture's place-name
//   generator) or a base whose bynames it borrows ("English" for Human Generic).
// - form, lineage, wife: the default convention (see NameConventions.js).
// - min, max: a given name's length.

export const FANTASY_BASES = {
    "Human Generic": {
        form: "inherited", wife: "takes", stem: 0.15, min: 3, max: 9,
        // Trained on a blend of the real European bases' names, so they read as human but belong to no one tradition
        blend: ["English", "German", "French", "Nordic", "Italian"],
        endings: { m: "ric,win,ald,bert,mund,an,on,el", f: "a,ia,wen,ild,ette,ine,is" },
        family: { place: 0.3, trade: 0.3, feature: 0.2, father: 0.2, words: "English" },
    },
    Elven: {
        form: "inherited", wife: "takes", stem: 0.35, min: 4, max: 10,
        m: "Aelindor,Calathiel,Erendar,Faelorin,Galveth,Ithrandel,Lirendor,Maeloth,Nerathil,Orlindel,Quelvar,Rhovanel,Saerith,Thalendir,Vaeloran,Aranthel,Celvarin,Eldrinor,Ilvareth,Melandir,Sylvaran,Tirandel,Elorathin,Faenor",
        f: "Aelith,Calenwe,Elanthe,Faewen,Galveniel,Ilyanna,Liriel,Maelis,Nerewyn,Orlaith,Quessia,Rhovenna,Saelwyn,Thaliel,Vaelith,Arwathe,Celessa,Eldriel,Ilsevel,Melwen,Sylvanne,Tirielle,Elowen,Faeryn",
        endings: { m: "ion,or,ar,il,andir,as,eth,ian", f: "iel,wen,ith,ara,iel,ia,ene,eth" },
        family: { place: 1 },
    },
    "Dark Elven": {
        form: "inherited", wife: "takes", lineage: "mother", stem: 0.35, min: 4, max: 10,
        m: "Vrennoth,Zaurik,Ilzarn,Mezzrin,Tsalvek,Nhaurel,Quavrin,Szelkar,Druvaen,Velzrith,Khalzar,Ryzzik,Ulvarn,Xarnoth,Zhendril,Vyrkas,Ilphaur,Molzeth,Nyzzar,Sorveth",
        f: "Ilvressa,Zhaeline,Quavra,Szendra,Vhessiir,Nhalyra,Tsabrae,Mezzira,Druvaena,Velzra,Khalisse,Rysseth,Ulvrae,Xandriira,Zhenna,Vyrkiel,Ilphae,Molzra,Nyzzira,Sorvyrr",
        endings: { m: "aun,ryl,in,ar,yn,aze,ek", f: "ae,ra,iira,eth,ra,yrr,ene" },
        family: { place: 1 },
    },
    Dwarven: {
        form: "clan", wife: "keeps", stem: 0.3, min: 4, max: 8,
        m: "Baldrek,Thrornik,Kazgrim,Durnak,Morbek,Grundar,Halvrik,Torvald,Brokkur,Dorgrim,Kildur,Ragnek,Stonvar,Thorgal,Ulfrek,Varnok,Gormund,Haldrin,Orsk,Brandur,Dagvik,Fundrak,Keldorn,Rurvin",
        f: "Brunvild,Dagnja,Hildra,Kathgra,Mardis,Thorga,Ulfhild,Vistrid,Gerdun,Helvra,Ingrith,Rannveig,Sigdra,Torvild,Bergra,Dorvis,Frenna,Gundis,Kolra,Orvild,Raskja,Thyrna,Yrsa,Eldhild",
        endings: { m: "in,ar,ur,ik,grim,dek,rak", f: "a,hild,dis,ryn,ja,unn,ra" },
        family: { place: 1 },
        clan: { m: ["{c}"], f: ["{c}"] },
    },
    Goblin: {
        form: "single", wife: "keeps", stem: 0.4, min: 3, max: 7,
        m: "Grik,Snag,Mukk,Zib,Skrag,Nogg,Grizzit,Yark,Splug,Blik,Krat,Zukk,Snikt,Gob,Rikkit,Drub,Fizzle,Nub,Skab,Twitch",
        f: "Grikka,Sniv,Mizzi,Zibba,Skritta,Nogga,Yeeka,Blixa,Krittle,Zukka,Snakka,Gobbie,Rikka,Drubbi,Fizza,Nubba,Skabbi,Twilla,Ixi,Vrikka",
        endings: { m: "ik,ug,ag,it,ub,kk", f: "a,ka,i,za,ix,illa" },
        family: { place: 0.5 },
    },
    Orc: {
        form: "clan", wife: "keeps", stem: 0.4, min: 4, max: 8,
        m: "Grushnak,Ulbrak,Mogdush,Krashug,Thurzog,Gorlash,Narbuk,Ruzgar,Shagrok,Uzdrak,Bolgar,Durgash,Grommuk,Harzog,Kurbag,Mugrash,Oglub,Thrakk,Vorgul,Zagrok,Lugdush,Morzug,Nazbuk,Skarnag",
        f: "Grushka,Ulbra,Mogdra,Krasha,Thurza,Gorla,Narbha,Ruzga,Shagra,Uzdra,Bolgha,Durga,Gromma,Harza,Kurba,Mugra,Ogla,Thrakka,Vorga,Zagra,Lugza,Morzha,Nazra,Skarna",
        endings: { m: "ash,ug,ok,ag,gul,dush,rak", f: "a,ra,gra,ka,sha,za" },
        family: { place: 1 },
        clan: { m: ["{c}"], f: ["{c}"] },
    },
    Giant: {
        form: "single", wife: "keeps", stem: 0.4, min: 4, max: 10,
        m: "Thrymvar,Hrungar,Bergholm,Skrymnir,Gymvald,Baugrim,Fornvar,Grungmar,Ottkell,Brakkar,Haldrumm,Jotvar,Kolgrim,Ymrath,Sturmund,Vafnir,Geirholt,Hymvald,Steinbard,Thrudmar",
        f: "Skaddra,Gerdhild,Gunnvor,Hyrra,Angvild,Jarnhild,Gjalra,Greipa,Hrimvor,Bestra,Gridhild,Hrodrun,Jordhild,Kalda,Morna,Ranvaig,Steinhild,Thrudvara,Vellmora,Isgerd",
        endings: { m: "ir,ung,ar,umm,od,grim", f: "a,hild,ing,run,bod,ara" },
        family: { place: 0.5 },
    },
    Draconic: {
        form: "single", wife: "keeps", stem: 0.45, min: 5, max: 13,
        m: "Vorathrax,Kelzarion,Myrrhanoth,Szarvex,Thalorax,Ixalgoth,Baelurion,Draxinoth,Quarrazul,Rhazzarion,Sevorath,Tyrraxis,Ulmarath,Zorvalith,Ashkaroth,Vexarion,Karrudax,Morvathis,Nythraxis,Orrovath",
        f: "Vyrathia,Kelzara,Myrrhessa,Szarvyx,Thaloria,Ixalith,Baelyra,Draxira,Quarrisa,Rhazira,Sevorra,Tyrrisa,Ulmara,Zorvelle,Ashkara,Vexira,Karrisyx,Morvessa,Nythara,Orroveth",
        endings: { m: "ax,arax,ion,oth,arr,ash,yrth", f: "ira,yx,ath,ara,eth,issa,ix" },
        family: { place: 0.3 },
    },
    Arachnid: {
        form: "single", wife: "keeps", lineage: "mother", stem: 0.45, min: 4, max: 10,
        m: "Ssik,Tchk,Zzarit,Kreesh,Vssk,Ithrik,Ksskir,Tzzat,Shrik,Kchit,Zhress,Skitta,Vrisk,Thssk,Ixxit",
        f: "Shelaxa,Vennolith,Zissrea,Tchessra,Ksshiri,Vessira,Ithrissa,Zhyrra,Skiretha,Nessith,Arakhra,Thessika,Vrissa,Kchira,Ixxara",
        endings: { m: "ik,isk,it,esh,ssk,ir", f: "ra,issa,ith,ira,eth,axa" },
        family: { place: 0.3 },
    },
    Serpents: {
        form: "single", wife: "keeps", stem: 0.45, min: 4, max: 10,
        m: "Ssethis,Haszar,Ssarak,Vasith,Yssith,Kesseth,Zahass,Shessar,Ophith,Naszar,Sithis,Hissarn,Ssorath,Vassek,Thessiss",
        f: "Sseria,Hassira,Ysslae,Vasha,Nessiss,Ophira,Zessa,Sythra,Kassira,Shissa,Ithessa,Ssariel,Naashi,Vessith,Yssara",
        endings: { m: "ith,ar,ek,ass,oth,is", f: "a,ira,ssa,ae,eth,ith" },
        family: { place: 0.3 },
    },
};

// Names of famous rulers and of well-known characters in games and books. No household carries
// one: lists leave them out, and a name a chain makes that is on this list is drawn again.
// Written for the names prototype (MIT); names alone, for matching.
export const FAMOUS = new Set(
    ("Hammurabi,Sargon,Ashurbanipal,Nebuchadnezzar,Gilgamesh,Kamehameha,Liliuokalani,Temüjin,Genghis,Kublai,Ögedei,Möngke," +
        "Pachakutiq,Atawallpa,Montezuma,Moctezuma,Cuauhtémoc,Nezahualcoyotl,Charlemagne,Napoleon,Caesar,Cleopatra,Saladin,Suleiman," +
        "Drizzt,Bruenor,Jarlaxle,Zaknafein,Elminster,Gandalf,Aragorn,Legolas,Gimli,Thorin,Frodo,Bilbo,Galadriel,Celeborn,Elrond,Arwen," +
        "Sauron,Azog,Bolg,Gorbag,Shagrat,Ugluk,Grommash,Durotan,Thrall,Garona,Tiamat,Bahamut,Ashardalon,Lolth,Quenthel,Viconia,Smaug," +
        "Glorfindel,Thranduil,Feanor,Fingolfin,Luthien,Beren,Turin,Eowyn,Faramir,Boromir,Denethor,Saruman,Radagast,Balin,Dwalin,Gloin,Oin," +
        "Raistlin,Tanis,Tasslehoff,Sturm,Caramon,Alustriel,Khelben,Mordenkainen,Tenser,Bigby,Vecna,Strahd,Acererak")
        .split(","),
);
