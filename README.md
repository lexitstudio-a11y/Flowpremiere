# Keyframe Ease

Plugin UXP pour Premiere Pro qui applique des presets d'easing numériques
(courbe cubic-bezier ou formules bounce/elastic/back) aux keyframes,
équivalent conceptuel du plugin Flow pour After Effects.

## Pourquoi UXP (pas CEP) ?

Depuis Premiere Pro 2026, CEP n'est plus chargé nativement par l'application.
UXP est la plateforme actuelle. Tout le code (UI + logique Premiere) tourne
dans le contexte du panneau HTML/JS, via le module host `premierepro`
(`require("premierepro")`) — pas besoin de pont ExtendScript séparé comme en
CEP.

## Limite technique importante — pourquoi le "baking"

L'API de script de Premiere Pro n'expose **aucun moyen d'écrire des valeurs
numériques de handles bézier** sur une keyframe (contrairement à After
Effects). Seuls des modes d'interpolation discrets sont scriptables
(`Constants.InterpolationMode`: `LINEAR`, `BEZIER`, `HOLD`, ...).

Pour obtenir malgré tout une courbe d'easing personnalisée fidèle au preset
numérique choisi, le plugin **échantillonne la courbe à chaque frame** entre
les deux keyframes ciblées et écrit une keyframe `LINEAR` par frame. Comme
une vidéo n'a pas de valeur "entre deux frames", le résultat est exact — pas
une approximation — mais la timeline affichera une keyframe par frame sur le
segment easé plutôt que 2 keyframes avec handles. Le preset "Linear" est
l'exception : il ne fait que basculer les 2 keyframes existantes en mode
`LINEAR`, sans rien ajouter.

Segments limités à 600 frames pour éviter des transactions trop longues —
pensé pour des transitions courtes (< ~10-20s selon le frame rate), pas pour
animer une propriété sur toute une séquence.

## Pourquoi le playhead, et pas une sélection de keyframes dans le panneau ?

Ni CEP ni UXP n'exposent "quelles keyframes sont sélectionnées" dans
Effect Controls. Le contournement standard : placez la tête de lecture
**entre** les deux keyframes à easer (ou dessus/à proximité), choisissez la
propriété dans le menu déroulant, et cliquez sur Appliquer — le plugin cible
automatiquement la paire "keyframe précédente / keyframe suivante" la plus
proche du playhead sur cette propriété.

## Installation (test local)

1. Ouvrez le **UXP Developer Tool** (Adobe).
2. "Add Plugin" → sélectionnez `manifest.json` à la racine de ce dossier.
3. "Load" pour l'installer dans Premiere Pro, puis ouvrez le panneau via
   `Fenêtre > Extensions > Keyframe Ease`.
4. Utilisez "Watch"/rechargement à chaud dans UXP Developer Tool pendant le
   développement.

Requiert Premiere Pro **26.2 ou supérieur** (API `ComponentParam`/keyframes
disponible depuis 25.6, `getVideoFrameRate` depuis 26.2).

> Ce plugin a été écrit et vérifié contre la documentation officielle de
> l'API (`AdobeDocs/uxp-premiere-pro`), mais n'a **pas pu être testé dans une
> vraie instance de Premiere Pro** depuis cet environnement (pas de Premiere
> installé ici). Testez-le via UXP Developer Tool et signalez les écarts —
> notamment la structure exacte de `PointF`/`Keyframe.value` pour les
> propriétés à 2 dimensions comme Position, qui est la zone la plus à risque.

## Utilisation

1. Sélectionnez un clip dans la timeline.
2. Dans le panneau, cliquez sur **&#8635;** pour lister les propriétés
   animables du clip (Position, Scale, Rotation, Opacity, paramètres
   d'effets...).
3. Choisissez la propriété à easer dans le menu déroulant (elle doit avoir
   au moins 2 keyframes).
4. Placez la tête de lecture entre les 2 keyframes à easer.
5. Choisissez ou dessinez une courbe :
   - **Bezier** : glissez les 2 poignées sur le graphe, ou tapez x1/y1/x2/y2
     directement (mêmes conventions que `cubic-bezier()` CSS).
   - **Bounce / Elastic / Back** : courbes toutes faites avec un paramètre
     d'intensité.
6. `+` dans la grille de presets pour enregistrer la courbe actuelle sous un
   nom. Cliquez un preset existant pour le recharger dans l'éditeur.
7. **Appliquer entre les keyframes autour du playhead**.

Les presets sont stockés en local (`localStorage` du panneau) — propres à
cette installation de Premiere, pas synchronisés entre machines.

## Structure du projet

```
manifest.json     Manifest UXP (panel entrypoint, host premierepro)
index.html        UI du panneau
css/style.css      Styles
js/easing.js       Maths pures : solveur cubic-bezier + formules bounce/elastic/back
js/premiere.js     Tout l'accès à l'API premierepro (le seul fichier qui touche `ppro`)
js/main.js         UI : éditeur de courbe (canvas + drag), grille de presets, bouton Appliquer
icons/             Icônes SVG du plugin
```

## Pistes d'évolution

- Export/import des presets en fichier JSON (partage entre machines/équipe).
- Détection automatique du changement de sélection (au lieu du bouton
  rafraîchir), via les events du module `premierepro` si disponibles.
- Support de courbes spatiales (pas seulement temporelles) si l'API
  l'expose un jour.
