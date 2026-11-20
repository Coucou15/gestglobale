-- Numerotation des journaux internes par sequence PostgreSQL.
--
-- Les mouvements de stock et les operations de tresorerie passaient par un
-- compteur stocke en table, incremente par un UPDATE qui verrouille la
-- ligne jusqu'a la fin de la transaction. Chaque ticket remonte attendait
-- donc son tour derriere tous les autres : le test de charge a mesure
-- 15 elements par seconde, et ce chiffre n'aurait pas bouge en ajoutant
-- des caisses, puisque toutes se seraient mises dans la meme file.
--
-- Une sequence PostgreSQL n'est pas transactionnelle : elle ne verrouille
-- rien et monte en charge. En contrepartie elle peut laisser des trous
-- quand une transaction echoue — ce qui est sans consequence pour un
-- journal interne.
--
-- Les documents a valeur legale (factures, bons de commande, receptions,
-- inventaires) gardent le compteur sans trou de la table "Compteur".

CREATE SEQUENCE IF NOT EXISTS "mouvement_stock_numero_seq" AS bigint START WITH 1;
CREATE SEQUENCE IF NOT EXISTS "operation_tresorerie_numero_seq" AS bigint START WITH 1;
