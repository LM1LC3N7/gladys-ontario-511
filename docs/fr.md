# Ontario 511 (événements routiers et état des routes en hiver)

Intégration non officielle. Elle lit l'API pour développeurs **Ontario 511** du ministère des Transports de l'Ontario
(MTO) : les **événements** (incidents, travaux, fermetures) et l'**état des routes en hiver** du réseau provincial.
Elle demande une **clé de développeur** Ontario 511 gratuite.

> Cette intégration n'est pas une source officielle. Avant de prendre la route, consultez
> [Ontario 511](https://511on.ca/) lui-même. Les données peuvent être en retard sur la route, et l'intégration peut
> manquer un événement ou un changement de conditions.

Source : Ontario 511, ministère des Transports de l'Ontario, données fournies sous la Licence du gouvernement ouvert – Ontario
(https://www.ontario.ca/fr/page/licence-du-gouvernement-ouvert-ontario), comme l'indique l'entente d'accès
pour les développeurs d'Ontario 511. Les données sont fournies « telles quelles » et « selon leur disponibilité »,
sans garantie. L'intégration ne modifie pas les données : elle les filtre par zone et les résume. Elle n'est
approuvée ni par Ontario 511, ni par le ministère des Transports, ni par le gouvernement de l'Ontario.

**Jamais testée avec une vraie clé** : aucune clé n'était disponible pendant son écriture. Chaque requête et chaque
réponse suivent la documentation officielle (https://511on.ca/developers/doc et les pages de chaque point d'accès,
lues le 2026-11-27) et le refus que 511on.ca donne à une clé absente ou fausse (vu en direct : HTTP 400
`{"Message":"Invalid Key"}`). Les tests tournent contre un faux serveur construit d'après les exemples documentés.
Merci de signaler toute surprise sur le forum.

## Obtenir une clé de développeur

1. Créez un compte sur [511on.ca](https://511on.ca/) et ouvrez l'espace développeurs
   ([511on.ca/developers/doc](https://511on.ca/developers/doc)).
2. Demandez une clé. Le ministère demande un nom d'organisation et un contact, l'usage prévu (ici : « domotique, usage
   personnel dans Gladys Assistant, sans redistribution ») et les tiers qui reçoivent les données (aucun).
3. Collez la clé dans le champ **Clé de développeur** de la configuration. Gladys la garde dans sa base, ne la
   réaffiche jamais, et l'intégration ne l'envoie qu'à 511on.ca, dans l'adresse comme l'API le demande. Elle n'est
   jamais écrite dans les journaux, l'état ni `/data`.

## Ce que vous obtenez

Jusqu'à **trois zones de surveillance**, un appareil Gladys chacune. Une zone est un cercle autour d'un point (1 à
200 km), limité si vous le voulez à certaines routes (« 401, QEW, 400 »).

Chaque appareil de zone a :

| Fonction                          | Type     | Sens                                                                                      |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Événements en cours               | compteur | Tout événement listé par Ontario 511 et commencé, dans la zone                            |
| Incidents                         | compteur | Ceux de type « accidents et incidents »                                                   |
| Travaux                           | compteur | Ceux de type « travaux »                                                                  |
| Fermetures                        | compteur | Ceux de type « fermetures », ou avec toutes les voies bloquées (`IsFullClosure`)          |
| Tronçons en conditions hivernales | compteur | Tronçons de la zone dont le rapport récent indique neige, glace ou gadoue                 |
| Résumé                            | texte    | Les événements (fermetures, puis incidents, puis par distance), puis les tronçons d'hiver |

Le résumé et les noms d'appareils sont écrits dans la langue choisie (anglais par défaut, ou français) ;
l'intégration demande ses textes à Ontario 511 dans cette langue (`lang=en` ou `lang=fr`). Les noms de routes restent
tels qu'Ontario 511 les écrit.

**En cours** veut dire : listé par Ontario 511 et commencé, par rapport à l'heure du serveur d'Ontario 511 (en-tête
`Date` de sa réponse). Un événement dont le début est à venir (une fermeture prévue) n'est pas compté avant de
commencer. Un événement encore listé après sa fin prévue est encore compté (la fin était un plan). Les événements
récurrents (« All days: 23:59-05:00 ») comptent tant qu'Ontario 511 les liste : l'horaire est un texte, donné dans les
variables de scène. Un événement dont le début est inconnu compte comme en cours. Sans en-tête `Date`, l'horloge de
Gladys sert, si elle est plausible. Un `Date` à plus d'un jour de l'horloge de Gladys (l'une des deux est fausse), ou
pas de `Date` avec une horloge invraisemblable : rien n'est compté, et l'état le dit.

**Conditions hivernales** : chaque rapport d'état des routes donne ses conditions en mots (« Bare and dry road »,
« Partly snow covered », « Snow packed », « Ice covered »…). Un rapport avec neige, glace, gadoue, givre ou poudrerie
est hivernal ; un rapport fait seulement de chaussée nue, sèche ou mouillée est dégagé ; tout autre mot (« No
Report », « Closed »…) est inconnu et ne compte ni d'un côté ni de l'autre. Seuls les rapports **récents** comptent :
mis à jour dans les 24 heures avant l'heure du serveur. Quand aucun tronçon de la zone n'a de rapport récent et connu
(hors saison, rapports tous anciens), le compteur n'est **pas publié** (il reste inconnu, jamais 0) et le résumé dit
« Aucun rapport récent sur l'état des routes en hiver dans la zone ».

**Rien plutôt que 0** : une réponse qui n'est pas une liste (une page d'erreur), une liste dont plus de la moitié des
éléments est illisible, ou une liste de plus de 10 000 éléments, n'est jamais publiée comme 0. Chacune des deux
ressources est indépendante : quand l'une échoue, ses fonctions gardent leur dernière valeur, l'état dit pourquoi, et
l'autre est publiée quand même. Le résumé dit « Événements non lus » ou « État des routes en hiver non lu » pour celle
qui a échoué.

## Déclencheur de scène : « Nouvel événement Ontario 511 dans une zone »

Déclenché quand un événement en cours apparaît pour la première fois dans une zone et a été signalé, mis à jour ou
commencé dans les 2 dernières heures (heure du serveur). Filtres : zone, type d'événement (incident, fermeture,
travaux, autre). Variables : route, direction, description, commentaire, effet sur la circulation, voies touchées,
gravité, toutes voies fermées (oui/non), fermeture (oui/non), début et fin prévue (UTC, ISO 8601), distance au centre
de la zone (km), identifiant Ontario 511 de l'événement.

Il n'est pas déclenché par la première lecture d'une zone, ni après le déplacement d'une zone (nouveau centre, rayon
ou routes) : cette lecture apprend seulement ce qui est déjà là. Il n'est pas déclenché quand aucune heure n'est
fiable (voir plus haut). Au plus 20 événements par zone et par lecture : les autres viennent à la lecture suivante
(s'ils ont encore moins de 2 heures).

## Configuration

1. **Clé de développeur** (obligatoire).
2. **Langue** : anglais ou français.
3. **Intervalle de lecture** : 10 à 120 minutes (15 par défaut).
4. **Zone 1** (obligatoire), zones 2 et 3 (facultatives, laissées vides pour les désactiver) : un nom, la latitude et
   la longitude du centre (degrés décimaux, en Ontario), le rayon en km (20 par défaut), et si vous le voulez les
   routes à garder, séparées par des virgules (« 401, QEW, 400 » ; « Hwy 401 » ou « Highway 401 » marchent aussi).

Un champ refusé est nommé dans l'état (la valeur saisie n'y est pas répétée).

Le bouton **Voir la dernière lecture / réessayer la clé** dit ce qu'a donné la dernière lecture de chaque zone et quand
vient la suivante ; il ne lit pas Ontario 511. Seulement pendant qu'Ontario 511 refuse la clé, il lit : un essai par
appui (voir plus bas).

## La clé de développeur refusée

Quand Ontario 511 répond « Invalid Key » aux événements, l'intégration arrête aussitôt toute lecture : aucun essai
automatique, ni à l'intervalle suivant, ni après un redémarrage. L'état le dit. Une courte empreinte de la clé refusée
(8 bits d'un hachage salé, jamais la clé) est gardée dans `/data` pour qu'un redémarrage ne la renvoie pas. Les
lectures reprennent quand :

- vous enregistrez une autre clé dans la configuration (une nouvelle clé est essayée : aussitôt pendant que Gladys
  tourne, à l'intervalle après un redémarrage, voir le cas de 1 sur 256 plus bas) ;
- ou vous appuyez sur le bouton de test : un essai par appui, en arrière-plan, au rythme de toute requête (au moins 7
  secondes après la précédente), jamais pendant une pause ; un appui pendant un essai ne fait rien. Un succès lève le
  refus et les lectures reprennent à l'intervalle.

Comme l'empreinte est si courte, une nouvelle clé saisie pendant que Gladys était arrêté a 1 chance sur 256 de
ressembler à la clé refusée : l'état dit alors que la clé est refusée, et un appui sur le bouton l'essaie.

Seul le refus documenté compte : HTTP 400 avec le message « Invalid Key ». Un 401, un 403, un autre 400, une page
illisible ne sont jamais un refus de la clé : ils mettent les lectures en pause comme une erreur du serveur (plus
bas). Quand seul l'état des routes est refusé alors que les événements sont lus avec la même clé, les événements
continuent et l'état des routes est redemandé plus tard : à la lecture suivante, puis toutes les 30 minutes, puis
toutes les heures au plus ; les lectures ne sont jamais mises en pause pour cela.

## Rythme et courtoisie envers Ontario 511

Ontario 511 publie sa limite : « Throttling is enabled. Ten calls every 60 seconds. » (dix appels toutes les 60
secondes). L'intégration reste en dessous :

- Deux appels par lecture (événements, puis état des routes), quel que soit le nombre de zones : Ontario 511 n'a pas
  de filtre par zone, chaque ressource est donc lue une fois pour toute la province et partagée par les zones. Un
  appel à la fois, au moins 7 secondes entre les débuts de deux appels : au plus 9 appels par minute, bouton de test
  compris.
- Une lecture à chaque intervalle, 10 minutes au moins, mesuré depuis le début de la lecture précédente.
- Pas de lecture plus tôt après un redémarrage, une reconnexion à Gladys, une configuration enregistrée sans
  changement ou une Découverte (l'heure de la dernière tentative est gardée dans `/data`, et en mémoire) ; déplacer
  une zone ou enregistrer une autre clé lit aussitôt, 7 secondes après le dernier appel.
- Quand `/data` ne peut pas dire la dernière tentative (fichier illisible, date dans le futur, `/data` non inscriptible
  ou qui ne répond pas en 2 secondes), la première lecture attend 10 minutes après le démarrage, et l'état le dit ; un
  `/data` illisible est relu toutes les 10 secondes, et ce qu'il contient (pause, clé refusée, événements déjà vus)
  revient dès qu'il se lit.
- Après un **429** (« trop de requêtes », par exemple quand la même clé sert ailleurs), toutes les lectures sont en
  pause 2 minutes, puis 4, 8… jusqu'à 6 heures ; après une erreur du serveur (**5xx**) ou un autre code inattendu
  (401, 403, 404, un 400 autre que « Invalid Key »), 5 minutes, puis 10, 20… jusqu'à 6 heures ; un `Retry-After` plus
  long est respecté, jusqu'à 6 heures. La pause est gardée dans `/data` d'un redémarrage à l'autre ; le doublement
  repart de zéro après une lecture réussie.
- User-Agent `gladys-ontario-511/<version> (+https://github.com/LM1LC3N7/gladys-ontario-511)`.
- Une réponse est coupée après 30 secondes ou 16 Mo.

Ontario 511 ne dit pas à quel rythme ses données sont mises à jour (« en temps réel ») ; l'intégration ne lit pas plus
souvent que toutes les 10 minutes.

## État

L'écran de configuration montre, pour chaque zone, les comptes de la dernière lecture et son heure (heure de l'Est),
ou, pour chaque ressource en échec, pourquoi et l'heure de ses dernières données. Des données de plus de 2 heures sont
dites périmées. L'intégration est montrée connectée quand la dernière lecture d'au moins une ressource a réussi il y a
moins de 2 heures, et que la clé n'est pas refusée.

## Vie privée

Les coordonnées de vos zones restent dans la configuration de Gladys : Ontario 511 ne reçoit aucune position (toute la
province est lue). Le fichier `/data` contient l'heure de la dernière tentative, la pause, l'empreinte de 8 bits d'une
clé refusée, et par zone les identifiants des événements déjà vus avec une empreinte salée de la zone, pas ses
coordonnées.

## Limites

- Ontario seulement (le centre de la zone doit être en Ontario ; les données près des frontières sont incluses).
- Jamais testée avec une vraie clé, ni par un utilisateur en Ontario (voir plus haut). La réponse d'Ontario 511 en cas
  de dépassement n'est pas documentée : un 429 est supposé.
- La ressource des projets de construction (projets à long terme) et les caméras ne sont pas lues dans cette version.
