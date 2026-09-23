-- O quiz id = 1 e o importado

INSERT INTO `testing`.`hu_quizzes` (`name`, `is_active`, `created_at`, `updated_at`)
    VALUES ('IMPORTADO', 0, NOW(), NOW());

DROP PROCEDURE IF EXISTS _tmp_update_groups;
DELIMITER $$
CREATE PROCEDURE _tmp_update_groups()
BEGIN
    DECLARE cursor_List_groups BOOLEAN DEFAULT FALSE;

    -- Vars
    DECLARE _id INT;
    DECLARE _text VARCHAR(255);

     DECLARE cursor_List CURSOR FOR
         SELECT
                `id`,
                `text`
               FROM `guestqui_hotelutils`.`quiz_headers`;


DECLARE CONTINUE HANDLER FOR NOT FOUND SET cursor_List_groups = TRUE;

OPEN cursor_List;

   loop_List: LOOP
      FETCH cursor_List INTO
            _id,
            _text;

        IF cursor_List_groups THEN
            LEAVE loop_List;
        END IF;

     INSERT INTO `testing`.`hu_quiz_headers`
                                        ( `id`,
                                          `quiz_id`,
                                          `title`,
                                          `order`,
                                          `is_active`,
                                          `created_at`,
                                          `updated_at`)
                                VALUES (
                                            _id,
                                            1,
                                            _text,
                                            _id,
                                            0,
                                            NOW(),
                                            NOW());

END LOOP loop_List;

   CLOSE cursor_List;
END

$$

DELIMITER ;

CALL _tmp_update_groups();
