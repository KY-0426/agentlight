UPDATE `users` SET `display_name` = LEFT(`display_name`, 20) WHERE CHAR_LENGTH(`display_name`) > 20;--> statement-breakpoint
ALTER TABLE `users` MODIFY `display_name` varchar(20) NOT NULL;
