DROP PROCEDURE IF EXISTS _tmp_update_guests;
DELIMITER $$
CREATE PROCEDURE _tmp_update_guests()
BEGIN
   DECLARE cursor_List_isdone BOOLEAN DEFAULT FALSE;

   DECLARE _id INT;
   DECLARE _code VARCHAR(255) DEFAULT '';
   DECLARE _name VARCHAR(255);
   DECLARE _last_name VARCHAR(255);
   DECLARE _address1 VARCHAR(255);
   DECLARE _address2 VARCHAR(255);
   DECLARE _address3 VARCHAR(255);
   DECLARE _zip_code VARCHAR(255);
   DECLARE _city VARCHAR(255);
   DECLARE _country VARCHAR(255);
   DECLARE _phone VARCHAR(255);
   DECLARE _email VARCHAR(255);
   DECLARE _nif VARCHAR(255);
   DECLARE _gender SMALLINT(6);
   DECLARE _doc SMALLINT(6);
   DECLARE _doc_number VARCHAR(255);
   DECLARE _doc_number_id_control VARCHAR(255);
   DECLARE _doc_date DATE;
   DECLARE _doc_valid DATE;
   DECLARE _doc_local VARCHAR(255);
   DECLARE _doc_country VARCHAR(255);
   DECLARE _doc_by VARCHAR(255);
   DECLARE _birth_local VARCHAR(255);
   DECLARE _birth_date DATE;
   DECLARE _nationality VARCHAR(255);
   DECLARE _mailable TINYINT(1);
   DECLARE _has_changes TINYINT(1);

   DECLARE _uuid VARCHAR(255);

   DECLARE _created_at DATETIME;
   DECLARE _updated_at DATETIME;


   DECLARE cursor_List CURSOR FOR
      SELECT   `id`,
               `code`,
               `name`,
               `lastName`,
               `address1`,
               `address2`,
               `address3`,
               `zipCode`,
               `city`,
               `country`,
               `phone`,
               `email`,
               `nif`,
               `gender`,
               `doc`,
               `docNumber`,
               `docNumberIdControl`,
               `docDate`,
               `docValid`,
               `docLocal`,
               `docCountry`,
               `docBy`,
               `birthLocal`,
               `birthDate`,
               `nationality`,
               `uuid`,
               `mailable`,
               `has_changes`,
               `created_at`,
               `updated_at`
               FROM `guestqui_hotelutils`.`guests`;

   DECLARE CONTINUE HANDLER FOR NOT FOUND SET cursor_List_isdone = TRUE;

   OPEN cursor_List;

   loop_List: LOOP
      FETCH cursor_List INTO _id,
         _code,
         _name,
         _last_name,
         _address1,
         _address2,
         _address3,
         _zip_code,
         _city,
         _country,
         _phone,
         _email,
         _nif,
         _gender,
         _doc,
         _doc_number,
         _doc_number_id_control,
         _doc_date,
         _doc_valid,
         _doc_local,
         _doc_country,
         _doc_by,
         _birth_local,
         _birth_date,
         _nationality,
         _uuid,
         _mailable,
         _has_changes,
         _created_at,
         _updated_at;

      IF cursor_List_isdone THEN
         LEAVE loop_List;
      END IF;

      INSERT INTO `testing`.`hu_guests` ( `id`,
                                          `code`,
                                          `name`,
                                          `last_name`,
                                          `address1`,
                                          `address2`,
                                          `address3`,
                                          `zip_code`,
                                          `city`,
                                          `country`,
                                          `phone`,
                                          `email`,
                                          `nif`,
                                          `gender`,
                                          `doc`,
                                          `doc_number`,
                                          `doc_number_id_control`,
                                          `doc_date`,
                                          `doc_valid`,
                                          `doc_local`,
                                          `doc_country`,
                                          `doc_by`,
                                          `birth_local`,
                                          `birth_date`,
                                          `nationality`,
                                          `uuid`,
                                          `mailable`,
                                          `has_changes`,
                                          `created_at`,
                                          `updated_at`)
                                VALUES (  _id,
                                          _code,
                                          _name,
                                          _last_name,
                                          _address1,
                                          _address2,
                                          _address3,
                                          _zip_code,
                                          _city,
                                          _country,
                                          _phone,
                                          _email,
                                          _nif,
                                          _gender,
                                          _doc,
                                          _doc_number,
                                          _doc_number_id_control,
                                          _doc_date,
                                          _doc_valid,
                                          _doc_local,
                                          _doc_country,
                                          _doc_by,
                                          _birth_local,
                                          _birth_date,
                                          _nationality,
                                          _uuid,
                                          _mailable,
                                          _has_changes,
                                          _created_at,
                                          _updated_at);

   END LOOP loop_List;

   CLOSE cursor_List;
END

$$

DELIMITER ;

CALL _tmp_update_guests();
