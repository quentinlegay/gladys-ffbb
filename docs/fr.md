# FFBB Basket — documentation

Suivez vos équipes de basket françaises dans Gladys : score en direct, prochain
match, résultat, et des scènes qui se déclenchent quand votre équipe joue,
marque ou gagne.

Les données viennent de l'API publique de la Fédération française de
basket-ball (FFBB), celle de son application officielle. Elle couvre les
championnats professionnels (Betclic ELITE, ELITE 2, LFB…) comme les
championnats nationaux (Nationale 1, 2, 3…). Pas de compte, pas de clé d'API.

> Cette API n'est pas documentée publiquement par la FFBB : elle peut changer
> sans préavis. L'intégration garde alors le dernier match connu et l'affiche
> comme injoignable plutôt que d'inventer un score.

## Configuration

1. Installez l'intégration depuis le catalogue de Gladys.
2. Dans le champ **Équipes**, écrivez les équipes à suivre sous la forme
   `COMPÉTITION:ÉQUIPE`, séparées par des virgules, par exemple :

   ```
   ELITE:Monaco, ELITE2:Nancy, NM1:Saint-Quentin, LFB:Bourges
   ```

   L'équipe est son nom, un mot de son nom (accents et majuscules ignorés),
   son abréviation, ou son identifiant de club FFBB. Si plusieurs équipes
   correspondent (`ELITE:Paris`), l'intégration vous demande de préciser.

3. Pas sûr du nom ? Le bouton **Trouver une équipe** liste les équipes d'une
   compétition avec le texte exact à copier.
4. Le bouton **Tester les équipes** lit la FFBB et dit, équipe par équipe, ce
   qui est suivi ou pourquoi une entrée ne l'est pas.
5. Chaque équipe devient un appareil dans l'onglet **Découverte** : créez-le.

| Réglage                        | Défaut         | Rôle                                                                |
| ------------------------------ | -------------- | ------------------------------------------------------------------- |
| Langue des textes de match     | Français       | Langue du texte « Match » des appareils et des scènes.              |
| Fuseau horaire                 | `Europe/Paris` | Fuseau dans lequel les heures de coup d'envoi sont écrites.         |
| Rappel avant le coup d'envoi   | 30 min         | Délai du déclencheur « Match bientôt » (0 = désactivé).             |
| Actualisation pendant un match | 30 s           | Fréquence de lecture du score en direct.                            |
| Actualisation entre les matchs | 15 min         | Fréquence de vérification du calendrier quand rien n'est en direct. |

## Compétitions

| Code     | Compétition                           | Aussi accepté     |
| -------- | ------------------------------------- | ----------------- |
| `ELITE`  | Betclic ELITE (ex-Pro A / Jeep ÉLITE) | `PROA`, `BETCLIC` |
| `ELITE2` | ELITE 2 (ex-Pro B)                    | `PROB`, `ELIT2`   |
| `NM1`    | Nationale 1 masculine                 | `N1`              |
| `NM2`    | Nationale 2 masculine                 | `N2`              |
| `NM3`    | Nationale 3 masculine                 | `N3`              |
| `LFB`    | La Boulangère Wonderligue (LFB)       | `LF1`             |
| `LF2`    | Ligue Féminine 2                      |                   |
| `NF1`    | Nationale 1 féminine                  |                   |
| `NF2`    | Nationale 2 féminine                  |                   |
| `NF3`    | Nationale 3 féminine                  |                   |

Une autre compétition FFBB peut être suivie en écrivant directement son code
FFBB (lettres et chiffres), par exemple `PNM:Mon Club`. La saison en cours est
choisie automatiquement : rien à changer d'une saison à l'autre.

## Appareils

Chaque équipe suivie est un appareil à trois fonctionnalités en lecture seule :

- **Score** : les points de l'équipe dans le match en cours (ou le dernier) ;
- **Score adverse** : les points de l'adversaire ;
- **Match** : une ligne de texte, par ex. `En direct · Q3 05:12 · MON 56 – 50 PLB`,
  `Terminé · MON 81 – 77 PLB · Victoire` ou
  `Prochain match · dim. 1 nov., 20:00 · contre PLB`.

Avant un match, les scores valent 0 : une condition « mon équipe mène » ne
reste pas vraie sur le score du match précédent.

## Scènes

Déclencheurs, filtrables par équipe et par domicile/extérieur :

| Déclencheur           | Quand                                                         | Variables en plus    |
| --------------------- | ------------------------------------------------------------- | -------------------- |
| Match bientôt         | Le délai de rappel avant le coup d'envoi est atteint.         | `kickoff`, `minutes` |
| Match commencé        | Le match passe en direct.                                     |                      |
| Mon équipe a marqué   | Le score de l'équipe a augmenté depuis la lecture précédente. | `points`             |
| L'adversaire a marqué | Le score adverse a augmenté.                                  | `points`             |
| Match terminé         | Le match est terminé (filtrable par victoire/défaite).        | `result`             |

Toutes portent `team_name`, `opponent`, `home_away`, `competition`,
`team_score`, `opponent_score` et `summary`. Au basket, les points arrivent
vite : « a marqué » se déclenche au plus une fois par lecture (toutes les
30 s par défaut) avec le total des points marqués entre deux lectures.

Action de scène **Lire le match d'une équipe** : donne aux actions suivantes
l'état (`pre`, `in`, `post`, `none`), les scores, l'adversaire, le coup
d'envoi, le résultat et le résumé du match en cours ou à venir.

## Widgets

- **Match d'une équipe** : score en direct, quart-temps et chrono, coup
  d'envoi, adversaire, bouton Actualiser.
- **Mes équipes** : toutes les équipes suivies, les matchs en direct d'abord.

## Fonctionnement

- Les équipes et les poules de chaque compétition sont lues une fois par jour ;
  les matchs des poules des équipes suivies à chaque lecture ; le flux « live »
  de la FFBB seulement quand un match d'une équipe suivie va commencer ou est en
  cours.
- Le score en direct vient du flux live de la FFBB (les compétitions avec
  feuille de marque électronique et statistiques en direct). Sans flux live,
  l'appareil affiche « Résultat en attente » jusqu'à ce que la FFBB saisisse le
  score final.
- Les heures sont celles saisies par la FFBB (heure de Paris). Un match sans
  horaire fixé affiche « horaire à fixer » et ne déclenche pas de rappel.

## Dépannage

- **« équipe absente de cette compétition »** : utilisez **Trouver une
  équipe** et copiez la ligne proposée.
- **« plusieurs équipes correspondent »** : écrivez le nom complet proposé.
- **« compétition introuvable à la FFBB cette saison »** : l'intégration a
  cherché la compétition par code puis par nom sans la trouver. Le bouton
  **Trouver une équipe** liste alors les compétitions FFBB de la saison avec
  leur code : écrivez ce code à la place du nôtre, par ex. `CODE:Paris`.
- **Appareil injoignable** : la FFBB ne répond pas ; le dernier match connu est
  conservé et la lecture reprend toute seule.
